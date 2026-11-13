# Flat model picker

Replaces the composer's model selector with a single flat panel. There are no
second-level menus: the model grid, the reasoning levels of the current model,
and the agent teamwork switch are all visible at once.

## What it does

- **One surface.** The trigger opens one panel capped at 320 px. The header,
  and one adaptive footer holding the reasoning group and the teamwork row,
  stay fixed; only the model grid scrolls. The two footer groups share a single
  line when both fit with a 30 px gap, and otherwise fall back to one row each.
- **Global search.** The search box filters across every provider and every
  family. Groups that end up empty are not rendered, so no stray headings
  remain. Prefix matches rank first, then substring matches, then ordered
  character matches.
- **Word-wise search.** Whitespace splits the query into tokens, and every
  token has to land somewhere in the name, so `mod inte` finds
  `ModelScope International` even though the two words are never contiguous.
  A hit ranks by its weakest token, so a multi-word query never outranks a
  plain prefix. A single-token query keeps the original ranking exactly.
- **Provider-wide search.** A query that matches a *provider* — its id, its
  catalog name, or the label its section draws — selects that provider as a
  whole: every model it offers stays in the grid, not only the ones whose names
  contain the query. Typing `dou` therefore surfaces `豆包(doubao)` with its
  entire catalog. Models matched by their own name still rank first; the rest
  follow in catalog order. Provider matching is word-wise too, and tokens may
  land in different faces of the same provider — the id answers `mod`, the
  localized name answers `inte`. It accepts prefixes and substrings only: an
  ordered-subsequence pass would let a two-letter query drag every provider in,
  which is noise rather than a match. This applies to both grouping modes.
- **Two grouping modes.** A segment control switches the grid between
  *By provider* and *By family*. Grouping and search are independent: the
  segment only changes how the filtered result is organised.
- **Model families.** A built-in dictionary recognises DeepSeek, Grok, Opus,
  Haiku, Sonnet, Claude, Qwen, GLM, Kimi, GPT, Gemini, Llama, Mistral and
  others. A model the dictionary does not cover is inferred from its id;
  anything unjudgeable falls into *Others*, which always sorts last. Families
  stay flat — no nesting.
- **Registered brands keep their generations apart.** Merging `hy3` and `hy4`
  into one `HY` family (DEC-004) was wrong: the generation has to be visible.
  A registered brand (`FAMILY_BRANDS`, currently `HY`) resolves to
  `BRAND + generation` when its id carries a generation digit, so `hy3` /
  `hy3-x` → `HY3`, `hy4-preview` / `hy4free` / `hy4std` → `HY4`, and a bare
  `hy` → `HY`. Generations rank next to their bare brand in numeric order.
  Unregistered brands still collapse their version tail (`acme4-turbo` and
  `acme-7b` are one `Acme`), and dictionary families are never split by
  generation. A provider prefix does not hide the brand (`codebuddy-hy3` →
  `HY3`).
- **Family-grouped rows are provider-primary.** A family heading says what the
  models *are*, so the family name is not repeated in a row. The row's primary
  text is the provider name — the one thing a heading cannot tell you when a
  family spans providers. The full model name and description stay in the row
  tooltip. Only when one provider offers several models in the same family do
  those rows carry a short secondary variant derived from the id tail (e.g.
  `hy4free` → `free`, `hy3-x` → `x`); the plain base model carries no tag.
  Colliding variants fall back to the unique model id. Under *By provider* the
  heading already is the provider, so the primary text stays the model name and
  no secondary tag is drawn.
- **Adaptive columns.** The panel measures one group title and one model row,
  subtracts the fixed sections from the 320 px cap, and picks the smallest
  column count from 1 to 3 that fits. If even three columns overflow, it keeps
  three and the grid scrolls. A group title never separates from its first
  model, and the last column's deficit is balanced against its neighbour.
- **Reasoning levels.** The current model's advertised levels render as a
  caption ("推理等级" / "Reasoning effort") with a sparkle icon and a hint
  tooltip, on the same line as a multi-segmentation control — the track wraps
  to its own line only when the row cannot fit. The segments are radio
  choices (`role="radiogroup"` / `role="radio"`, exactly one `aria-checked`
  at a time, arrow keys move the selection) drawn with the header segment's
  visual: a toned track and a floating active segment, so the active level is
  unmistakable. A click submits through `session.selectModel` and the group
  refreshes from the directory once it updates. A model without reasoning
  metadata hides the whole group, and it costs no height.
  The group shares a wrapping footer line with the teamwork row: when
  reasoning + 30 px + teamwork fits the panel's inner width they sit side by
  side, otherwise the footer wraps back to the original two-line stack. The
  break is decided by CSS flex wrapping and the 30 px `column-gap`, never by a
  JS width threshold, so it stays correct across panel resizes, font loads and
  both themes. The single grey rule above the reasoning group stays where it
  is in both states; the teamwork row draws no divider of its own (DEC-011).
  The fixed height budget measures the footer container once, not its two
  children, so a shared line is not double-counted against the grid.
- **Selected model.** The current model reads as a solid deep-blue band with
  white, bold text — no checkmark on the right. Selection lives on the row
  itself (`aria-pressed="true"`), so nothing is reserved at the trailing edge:
  unselected rows keep their full width for the name, the provider tag, and the
  badge, and the measurement probe no longer mirrors a tail column. The blue
  is `--dsw-static-deepseek-600` and the text is
  `--dsw-static-neutral-bluish-00`, both from the theme-invariant static
  palette, so the band looks the same in light and dark themes. Hover skips the
  selected row so the neutral hover wash never covers the highlight.
- **Badges.** A model's catalog badge (for example a third-party rate
  multiplier such as `×0.1`) renders inside its row. A model with no badge
  renders no empty slot. On the selected row the badge switches to a
  translucent white chip so it stays legible on the blue fill.
- **Agent teamwork.** The switch keeps the host's semantics: the same label,
  the same confirmation before disabling it mid-conversation, and no optimistic
  update — the state comes from the `agentTeam` projection. The row lives in
  the shared footer line described under *Reasoning levels*, immediately right
  of the reasoning group when both fit on one line.

## Data and interaction

Everything goes through public Client APIs:

- `ctx.modelDirectories.directoryFor(sessionId)` supplies the catalog, the
  current selection, and the pending selection; `load()` refreshes it and
  `select()` submits.
- The directory store is subscribed through `useSyncExternalStore`, so a
  catalog update — including one caused by a selection — repaints the panel.
- `ctx.get('remote').agentTeams.setEnabled()` writes the teamwork selection.
- `ctx.locale` supplies the copy, resolves catalog badge text, and prefers the
  host's own `agent-team` wording when that namespace is registered.

No host component, stylesheet, or DOM is read or restyled.

## Layout behaviour

- Window resize, a grouping switch, and search input all re-plan the columns,
  debounced, and the plan runs once more after fonts finish loading so the
  first frame's measurements do not stick.
- The panel opens above the trigger and flips below when there is no room,
  staying inside the viewport.
- An unbound Session, an empty catalog, a failed provider, and a search with no
  hits each have their own state. A directory that has not resolved yet still
  renders a trigger rather than blanking the composer.

## Styling

Colours, radii, spacing, and elevation come from the `--dsw-alias-*`,
`--dsw-static-*`, `--dsw-elevation-*`, `--dsw-menu-*`, and `--dsw-radius-*`
tokens, so light and dark themes both follow the host palette. The selected
row's blue is deliberately drawn from the static palette (`--dsw-static-*`),
which is theme-invariant: the alias `--dsw-alias-state-business-primary`
flips to a light blue with dark text in the dark theme, which would break the
requested deep-blue-with-white-text treatment there. The panel uses the same menu surface
material as the host's own menus (menu fill, backdrop blur, prominent
elevation, large radius), and hover, focus, selected, and disabled states follow
the shipped picker's visual language.

Each provider / family label is deliberately set apart from the model rows
beneath it: it draws as a filled, rounded band that floats on
`--dsw-alias-bg-layer-1` with `--dsw-elevation-soft` — the same recipe as the
active segment. That fill is opaque white in light themes and near-black in
dark, so it steps clearly away from the translucent panel surface (and the
transparent model rows) in both themes, with no hard-coded colour. The bare
`--dsw-alias-menu-group-header-fill` token was only a few levels from the
surface and read as almost the same background as the rows (see DEC-005). The
label keeps smaller but bold type with a stronger label colour. The model rows
stay 13 px regular text on a transparent background, so the band reads as a
section header rather than another selectable row.

The band also carries a low-key frame: a hairline border
(`--dsw-alias-border-l2`) and a short brand-blue left edge
(`--dsw-alias-state-business-primary`, the panel's own accent). That marks each
group start clearly without boxing the group's rows — a group's rows may flow
across columns, so only its label is framed (see DEC-003).

## Limitations

- The panel replaces the composer seat only; the `/model` popup is untouched.
- The panel does not host the `conversation.input.model.label` and
  `conversation.input.model.options` child slots. The shipped registration keeps
  those declarations alive, so other plugins' contributions stay valid; their
  content simply is not drawn inside this panel.
- Addressed subagent sessions hide the seat, matching the shipped selector.
- The badge comes from the catalog entry, so a provider that publishes no badge
  shows none.
