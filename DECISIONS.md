# DECISIONS

Project-level decision log for the dsh-model-flatmap plugin. Append-only: new
entries go below the marker, newest first; old entries are never rewritten.

<!-- APPEND-ONLY LOG: 新条目插入到此行之后 -->

## DEC-012 — ⛔️ 2026-11-13 — Family rows are provider-primary, and a brand's generations stay distinct

推翻: DEC-004 的两点结论（"每行以次级文字显示 provider" 与 "hy3/hy4 合并进一个 HY 家族"）。
DEC-004 条目本身保留原样，仅由本条声明其失效。

**Context.** After DEC-004 shipped, the user reported that under *By family*
the row content needed a smarter, more flexible treatment:

1. A family heading already says what the models ARE (and now, with the
   generation split, also which generation). Repeating a model/family name as
   the row's main text is redundant — the useful, missing information in a
   family that spans providers is WHERE a model comes from.
2. Merging `hy3` and `hy4` into one `HY` family was explicitly called a
   mistake: the model's **generation has to be distinguished**, not collapsed.

**Decision.**

- *Row content (By family).* The primary text becomes the **provider name**.
  The family name is not drawn in the row at all. The full model name and
  description move to (and stay in) the row tooltip. A short secondary variant
  is added **only on demand**: when one provider offers more than one model in
  the same family, those rows get an id-derived tail (`hy4free` → `free`,
  `hy3-x` → `x`, `hy4flash-exp1` → `flash exp1`); the plain base model carries
  no tag. Colliding variants fall back to the unique model id. Under
  *By provider* the primary text stays the model name and no tag is drawn.
- *Generation split.* A registered brand (`FAMILY_BRANDS`, currently `HY`)
  resolves to `BRAND + generation` from the id's leading digit, so `hy3` →
  `HY3`, `hy4free`/`hy4std`/`hy4-preview` → `HY4`, and a bare `hy` → `HY`.
  Dictionary families (GPT, Qwen, …) are never split. Unregistered brands
  keep DEC-004's collapse (`acme4-turbo` and `acme-7b` → `Acme`).
- Generations rank next to their bare brand in numeric order
  (`HY` < `HY3` < `HY4` < `Others`), so a new generation does not jump to the
  end of the grid.

**Rejected.** Keeping the model name as primary text with the provider as a
quiet tag (the DEC-004 shape) — it repeats the family name and buries the one
discriminating fact (the provider). A fixed variant on every row (noise when a
provider has one model in the family). Upper-casing all generations or splitting
dictionary families by version.

**Consequences.** `client.js`: `familyOf` now emits `HY3`/`HY4`, `familyRank`
orders generations, `idVariantOf`/`rowVariantOf` derive short tails, the
sections builder disambiguates per provider+family, and `renderRow` swaps the
primary/secondary roles. The measurement probe and 26 px row height are
unchanged (the tag still shares the model-name line). Render tests pin the
generation split, provider-primary text, no family name in a row, and the
on-demand variant; plan tests pin `familyOf`/`familyRank`/variant helpers.

## DEC-011 — 2026-11-13 — 分割线只放在模型网格与推理等级之间

**Context.** 用户要求：推理等级与智能体团队协作之间不要有分割线；模型网格与推理等级之间要有一条明显一些的灰色分割线。

**Decision.**

- 移除 `.dshmf-team` 原有的 `border-top: 0.5px solid var(--dsw-alias-border-l1)`，使推理等级与团队协作之间不再有线条。
- 在 `.dshmf-reason` 顶部加 `2px` 实线分割线，浅色模式用中等灰色 `#6B7280`，深色模式（`body[data-ds-dark-theme]` / `html[data-ds-dark-theme]`）用更亮的浅灰 `#D1D5DB`，并加 `padding-top: 6px`。
- 这里刻意不用 `--dsw-alias-border-*` token：这些 token 设计上就是极淡的边框，达不到用户反复要求的明显程度，因此用显式灰值加深色分支。

**Consequences.** 纯 CSS 变更；无布局、DOM、planner 改动。render 测试固定分割线的位置、颜色与团队协作无边框。

## DEC-010 — 2026-11-13 — Selected model: deep-blue band with white bold text, no checkmark

**Context.** The selected model was marked only by a 14px checkmark at the
right edge of its row. That reserved a trailing column on *every* row (empty
on all the unselected ones) and read as a weak, easy-to-miss glyph. The user
asked for a space-saving treatment: no checkmark, a deep-blue background and
white bold text on the selected row.

**Decision.**

- Drop `PATH_CHECK` and the checkmark branch in `renderRow`; the selection is
  carried by the row itself through `aria-pressed="true"`.
- The selected row draws as a solid band: `background:
  --dsw-static-deepseek-600` (deep blue `#4868b2`), `color:
  --dsw-static-neutral-bluish-00` (white), `font-weight: 600`. White on that
  blue measures 5.39:1, and the fill stands apart from the panel surface in
  both themes (5.33:1 light, 2.77:1 dark).
- The blue is pinned to the **static** palette, not
  `--dsw-alias-state-business-primary`: that alias is deepseek-500 in light
  but flips to light deepseek-400 in dark, which would paint a light-blue band
  with the theme's dark foreground — the opposite of the requested deep blue
  with white text. The static `--dsw-static-*` tokens are defined once in the
  host's global `body` rule and are identical in both themes.
- Hover is skipped for the selected row
  (`:not([aria-pressed="true"])`), so the neutral hover wash cannot cover the
  highlight. Provider tags inherit the white text (slightly dimmed) and
  badges become a translucent white chip so both stay legible on the fill.
- The trailing tail element is now drawn only for a pending selection (the
  spinner); the measurement probe no longer mirrors a tail column. Since the
  row height is fixed at 26px, no planner change is needed.

**Rejected.** An alias-based blue fill + `--dsw-alias-label-primary-foreground`
text (the host's own chip recipe): it inverts to light blue / dark text in the
dark theme. Keeping a fixed 14px tail for the checkmark (wastes horizontal
space on every unselected row).

**Consequences.** Purely a CSS + render-path change; the row keeps its 26px
height and the column planner, probe measurements, and selection semantics
(`aria-pressed`) are unchanged. Render tests pin the CSS recipe, the absence
of the check path/glyph, and the tail-free probe.


## DEC-005 — 2026-11-13 — Float the group-title band on an opaque layer fill

**Context.** DEC-003 added a low-key frame to the group label but kept its
`--dsw-alias-menu-group-header-fill` background. The user then reported the
grouping title's background was still too close to the row / panel background.
In both themes that fill is only a few levels from the panel/menu surface the
rows sit on (light: `rgba(248,249,250,.94)` band vs `rgba(252,253,254,.7)`
surface; dark: `rgba(48,49,54,.94)` vs `rgba(48,49,54,.64)`), so the band did
not read as a separate section header.

**Decision.** Keep the DEC-003 frame (hairline + grey left edge) untouched and
change only the band's fill to `--dsw-alias-bg-overlay` plus
`--dsw-elevation-soft` — the exact recipe the panel already uses for its
active segment (`.dshmf-segBtn[aria-pressed]`, `.dshmf-pill[aria-checked]`).
Crucially `bg-layer-1` (the first attempt) is opaque white in light and
near-black in dark — i.e. it matched the panel surface in *both* themes, which
is exactly why the band read as flat. `bg-overlay` resolves to a soft grey in
light (`bluish-150` ≈ #e9ecf2, visibly darker than the white panel) and a light
grey in dark (`bluish-700` ≈ #61666b, visibly lighter than the near-black
surface), so the band steps clearly away from the translucent panel surface in
both themes with no hard-coded colour and no second theme branch. Rows stay
transparent (background only on hover/focus), so the band is the only standing
separation.

**Rejected.** `bg-layer-1` (opaque white/near-black — matches the panel surface
in *both* themes, so the band reads flat; this is why the first pass had weak
contrast), a `color-mix` tint toward `--dsw-alias-label-primary` (compositing
math showed it *reduces* separation in most cases), a tint toward `bg-layer-1`
(only a few levels of gain and worse on dark pages), a hard-coded
darker/lighter fill (breaks theme token purity), and `interactive-bg-hover` (a
translucent hover tint that would blur the row's own hover state).

**Consequences.** CSS-only on `.dshmf-groupTitle`; the frame, height, padding,
and line-height from DEC-003 are preserved, so the probe-measured `headH` and
the column planner stay valid. The render tests pin the opaque grey overlay
fill (and assert it is *not* the panel base/layer-1 surface), the absence of the
near-surface group-header fill, the soft elevation, the DEC-003 frame, and the
row's transparent background so the old near-identical flat fill cannot
regress.

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
