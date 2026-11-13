# DECISIONS

Project-level decision log for the dsh-model-flatmap plugin. Append-only: new
entries go below the marker, newest first; old entries are never rewritten.

<!-- APPEND-ONLY LOG: 新条目插入到此行之后 -->

## DEC-005 — 2026-11-13 — Float the group-title band on an opaque layer fill

**Context.** DEC-003 added a low-key frame to the group label but kept its
`--dsw-alias-menu-group-header-fill` background. The user then reported the
grouping title's background was still too close to the row / panel background.
In both themes that fill is only a few levels from the panel/menu surface the
rows sit on (light: `rgba(248,249,250,.94)` band vs `rgba(252,253,254,.7)`
surface; dark: `rgba(48,49,54,.94)` vs `rgba(48,49,54,.64)`), so the band did
not read as a separate section header.

**Decision.** Keep the DEC-003 frame (hairline + brand left edge) untouched and
change only the band's fill to `--dsw-alias-bg-layer-1` plus
`--dsw-elevation-soft` — the exact recipe the panel already uses for its
active segment (`.dshmf-segBtn[aria-pressed]`, `.dshmf-pill[aria-checked]`).
`bg-layer-1` is opaque white in light and near-black in dark, so the band steps
clearly away from the translucent panel surface in both themes with no
hard-coded colour and no second theme branch. Rows stay transparent (background
only on hover/focus), so the band is the only standing separation.

**Rejected.** A `color-mix` tint toward `--dsw-alias-label-primary`
(compositing math showed it *reduces* separation in most cases — that token is
dark in light themes, but a light-theme band must get *lighter* than the
surface to stand out), a tint toward `bg-layer-1` (only a few levels of gain
and worse on dark pages), a hard-coded darker/lighter fill (breaks theme token
purity), and `interactive-bg-hover` (a translucent hover tint that would blur
the row's own hover state).

**Consequences.** CSS-only on `.dshmf-groupTitle`; the frame, height, padding,
and line-height from DEC-003 are preserved, so the probe-measured `headH` and
the column planner stay valid. The render tests pin the opaque layer-1 fill, the
absence of the near-surface group-header fill, the soft elevation, the DEC-003
frame, and the row's transparent background so the old near-identical fill
cannot regress.

## DEC-004 — 2026-11-13 — Family grouping: rows name their provider, and a family is a brand not a version

**Context.** Two problems with model-family grouping, both reported from the
real catalog:

1. A family heading says what a model *is*, but one family can hold models
   from several providers. Under family grouping the grid therefore gave no
   way to tell two same-named models from different providers apart.
2. Grouping was too fine. `hy3`, `hy4-preview` and `hy4free` arrived as three
   separate headings even though they are three versions of one brand.

**Decision.**

- Every row under *By provider* stays as it was. Under *By family* each row
  draws its provider as secondary text (`.dshmf-rowProvider`: caption colour,
  11 px, shrinks and ellipsises before the model name, no fixed width cap),
  and the row's `title` tooltip gains the provider on its own line. Under
  *By provider* the heading already is the provider, so no tag is drawn.
- The provider label is resolved ONCE per group and reused as the section
  title, the search face, and the per-row tag, so a localized catalog name
  (`{ zh, en }`) cannot make the heading and the tag disagree.
- A family is the brand, not the version. `BRAND_WITH_VERSION` strips a
  version tail (`hy4free` → `hy`), so every version of a brand lands in one
  heading. A registered brand list (`FAMILY_BRANDS`, currently `HY`) pins the
  exact heading casing and keeps that family in the normal sort order; the
  brand is looked up on every id segment, so a provider-prefixed id
  (`codebuddy-hy3`) still resolves to `HY`.
- The measurement probe now mirrors a family-grouped row (name + provider tag
  + tail), so the measured row height covers the tallest row shape.

**Rejected.** Showing the provider tag in *By provider* mode (the heading
already says it, so it would be pure noise); a fixed `max-width` on the tag
(it truncated "CodeBuddy CLI" to "CodeBuddy …" in a column that had room);
upper-casing every short brand (it would draw `phi-4` as `PHI` instead of the
dictionary's `Phi`).

**Consequences.** The three `hy*` headings collapse into one `HY` heading, so
the grid gets shorter and the column planner fits more models per column. A
family-grouped row is unchanged in height (26 px) because the tag shares the
model-name line. Render tests pin the tag's presence under family grouping,
its absence under provider grouping, the one-heading outcome for three `hy`
versions across two providers, and the localized-label agreement between
heading and tag.

## DEC-003 — 2026-11-13 — Groups get a low-key framed label; the rows stay unboxed

**Context.** The flat grid listed each provider/family as a tinted title band
over bare rows. The user asked for each group (provider or family, per the
active grouping) to carry a frame (线框) that is visible but unobtrusive —
low-key, simple, still good-looking. The dense layout flows a group's rows
across 1–3 columns, so a single box around a whole group is only possible if
the group becomes an indivisible placement unit — which would cost density for
large groups (a 30-model provider would become one tall scrolling card beside
ragged gaps under short groups).

**Decision.** Keep the dense row flow. Frame the group **label** instead:

- The title band gains a hairline frame — `1px solid
  --dsw-alias-border-l2` (≈10 % black in light, ≈12 % white in dark) — and a
  3 px left edge in `--dsw-alias-state-business-primary` (the panel's own
  DeepSeek-blue accent, ≈#7aaaff / #4176e6). The band stays 20 px tall, so the
  probe-measured `headH` and the column planner are untouched.
- The band keeps its filled, smaller-bold styling from the 2026-11-13 label
  restyle, so frame + accent + fill read as one calm section header.
- The rows themselves stay borderless and keep flowing across columns; a group
  that spans columns is marked at its head by the framed label.

**Rejected.** Boxing each group as an indivisible bordered card (a
`.dshmf-card` around title + rows, with the planner's units changed from rows
to cards): the cleanest "frame the whole group", but it breaks the row flow
across columns and costs density for large groups. The user explicitly chose
the weak divider over it.

**Consequences.** CSS-only on `.dshmf-groupTitle` (plus its render-test
assertions and this doc); no layout, planner, probe, or DOM-structure change.

## DEC-002 — ⛔️ 2026-11-13 — Reasoning effort: "推理等级" caption inline with a multi-segmentation control

取代: DEC-001 的视觉呈现（"思考强度" 文案、双行卡片容器、品牌色 pill 选中态）。
DEC-001 的 radio 语义（`radiogroup` / `radio` / `aria-checked` / 方向键）与
"固定区高度由 `reasonRef` 实测"的布局机制保持不变。

**Context.** After reviewing the labelled card, the user asked for the
caption to read "推理等级" (not "思考强度"), to sit on the same line as the
options whenever possible (wrapping only when the row cannot fit), and to
draw the options with the visual language of a multi-segmentation control.

**Decision.**

- Caption text: "推理等级" / "Reasoning effort"; the hint tooltip (what the
  setting adjusts) is kept.
- Layout: `display: flex; flex-wrap: wrap` — the caption and the segment
  track share one line; the track (a single flex item that does not shrink)
  wraps to its own line only when the row cannot fit, and scrolls
  horizontally if its content still overflows.
- Visual: the track reuses the header segment's recipe —
  `--dsw-alias-interactive-bg-hover` track, `--dsw-radius-sm` corners,
  2 px inset; the active segment floats on `--dsw-alias-bg-layer-1` with
  `--dsw-elevation-soft` and 500 weight (the brand-fill pill is dropped).
  Radio semantics and the checked-state rules are unchanged.

**Consequences.** The fixed section returns to a single ~26 px line in the
common case (shorter than DEC-001's two-line card), so the scrollable grid
gains height back. The panel now has one visual language for
"one-of-many, exactly one active" (header grouping + reasoning level).
Render tests still pin the radiogroup structure and exclusive
`aria-checked`; the t-stub label key is unchanged, so no test edits were
needed.

## DEC-001 — 2026-11-13 — Reasoning levels become a labelled, exclusive group

**Context.** The flat model picker rendered the current model's reasoning
efforts as a loose row of borderless pills with only a tooltip-level group
label. It was easy to miss that the block is a setting, hard to see which
level was active, and the mutual exclusivity of the choices was not expressed
in semantics or in pixels.

**Decision.**

- Wrap the effort pills in a visible group: a tinted, rounded container
  (`--dsw-alias-bg-module-platform` fill, `--dsw-radius-md`, inset 2 px) with
  a caption ("思考强度" / "Thinking intensity") plus a sparkle icon and a hint
  tooltip explaining that the setting adjusts how deeply the model thinks.
- Use radio semantics: `role="radiogroup"` + `role="radio"`, `aria-checked`
  (replacing `aria-pressed`), `aria-labelledby` naming the caption, and
  arrow-key navigation over the enabled pills, so exactly one level is ever
  selected and the group is fully keyboard-operable.
- The checked pill uses the brand fill (`--dsw-alias-brand-primary` with
  `--dsw-alias-label-primary-foreground` text — the same proven pairing as the
  host switch — plus `--dsw-elevation-soft`), making the selection
  unmistakable in both light and dark themes.

**Rejected.** Keeping `aria-pressed` buttons (no exclusive semantics, weak
selected state), and restyling the pills as a segmented control (would blur
against the provider/family segment in the header and still read as one of
many flat options).

**Consequences.** The fixed reasoning section grows by ~35 px, which the
column planner absorbs by shrinking the scrollable grid (the section height is
measured through `reasonRef`, no planner change needed). Render tests pin the
radiogroup structure, the caption, and exclusive `aria-checked`.
