# Flat model picker

Replaces the composer's model selector with a single flat panel. There are no
second-level menus: the model grid, the reasoning levels of the current model,
and the agent teamwork switch are all visible at once.

## What it does

- **One surface.** The trigger opens one panel capped at 320 px. The header,
  the reasoning row, and the teamwork row stay fixed; only the model grid
  scrolls.
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
- **A family is a brand, not a version.** A version tail never splits one
  brand into several headings, so `hy3`, `hy4-preview` and `hy4free` share a
  single `HY` family instead of producing three. The same rule covers
  `acme4-turbo` and `acme-7b`. A provider prefix on the id does not hide the
  brand either (`codebuddy-hy3` is still `HY`), and a registered brand keeps
  its own casing so `HY` does not read as the word "Hy".
- **Rows name their provider under family grouping.** A family heading says
  what the models *are*, and one family can hold models from several
  providers, so each row carries its provider as quiet secondary text (caption
  colour, 11 px, ellipsised before the model name). Under *By provider* the
  heading already is the provider, so the tag is not drawn.
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
- **Badges.** A model's catalog badge (for example a third-party rate
  multiplier such as `×0.1`) renders inside its row. A model with no badge
  renders no empty slot.
- **Agent teamwork.** The fixed bottom row is the host's OWN model-picker
  options slot: the panel declares `conversation.input.model.options` as a child
  slot (the same declaration the shipped `ModelSelect` makes) and renders it via
  `renderSlot`. That slot is where `dsh-client-ui-agent-team` registers its
  `TeamModeToggle`, so what appears here IS the shipped switch — identical label
  and description in every locale, the same info tooltip, the same Switch
  primitive chrome and on/off state, the same session-owned `agentTeam`
  projection with no optimistic update, and the host's own shell-overlay
  confirmation before disabling it mid-conversation. The panel supplies the
  same owner share the shipped picker does (`locked`, `dismiss`,
  `reportFailure`); a failed save is shown in the panel's error strip using the
  host's already-localized message. No copy, styling or confirmation flow is
  reimplemented.

## Data and interaction

Everything goes through public Client APIs:

- `ctx.modelDirectories.directoryFor(sessionId)` supplies the catalog, the
  current selection, and the pending selection; `load()` refreshes it and
  `select()` submits.
- The directory store is subscribed through `useSyncExternalStore`, so a
  catalog update — including one caused by a selection — repaints the panel.
- `renderSlot('conversation.input.model.options', { locked, dismiss,
  reportFailure })` delegates the teamwork selection entirely to the host's
  `TeamModeToggle` (which itself writes through `remote.agentTeams.setEnabled`
  using its own `agent-team` locale namespace).
- `ctx.locale` supplies the panel's own copy and resolves catalog badge text.

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

Colours, radii, spacing, and elevation come only from the `--dsw-alias-*`,
`--dsw-elevation-*`, `--dsw-menu-*`, and `--dsw-radius-*` tokens, so light and
dark themes both follow the host palette. The panel uses the same menu surface
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
- The panel declares both child slots the shipped seat declares, so every other
  plugin's contribution to them stays valid, and it renders the
  `conversation.input.model.options` list slot as its bottom row. It does not
  render the inline `conversation.input.model.label` slot — flat rows use the
  catalog's own model name and badge instead; that slot is declared only to keep
  the registration's child contract identical to the shipped one.
- Addressed and listed subagent sessions hide the seat; the host's own
  `TeamModeToggle` hides itself for those sessions too, so the two agree.
- The badge comes from the catalog entry, so a provider that publishes no badge
  shows none.
