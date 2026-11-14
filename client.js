/**
 * Flat model picker — browser half.
 *
 * Replaces the composer's `conversation.input.model` seat with ONE flat panel:
 * search, a provider/family grouping switch, the whole model grid, the current
 * model's reasoning levels, and the agent-teamwork switch — no second-level
 * menus anywhere.
 *
 * Everything is read and written through public Client APIs only:
 *   - `ctx.modelDirectories.directoryFor(sessionId)` → the per-Session directory
 *     (`store` for data + change subscription, `load()`, `select()`);
 *   - `ctx.get('remote').agentTeams.setEnabled()` → the teamwork selection;
 *   - `ctx.locale` → copy, catalog badge text resolution, and the host's own
 *     wording for the teamwork row;
 *   - the slot's standard props (`sessionId`, `useProjection`, `useSession`,
 *     `useSessions`) → Session state.
 *
 * Registration uses a negative priority so this entry shadows the shipped
 * `ModelSelect` while it is active; disabling the plugin restores the native
 * control with no residue. The shipped entry keeps its own child-slot
 * declarations (`conversation.input.model.label` / `.options`) alive, so no
 * other plugin's registration is invalidated by this replacement; this panel
 * simply does not host them, and draws the catalog's own model badge instead.
 * No host component, stylesheet or DOM is read.
 */
window.__ModuleLoader__.load({
  id: 'dsh-model-flatmap',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } = React
    const useSyncExternalStore = React.useSyncExternalStore

    // ---------------------------------------------------------------------
    // Stylesheet — theme tokens only. Inserted once per module generation with
    // the same data-plugin tags the host uses, so disposal is owned upstream.
    // ---------------------------------------------------------------------
    const CSS = `
.dshmf-root { position: relative; min-width: 0; }

/* Trigger: the shipped composer seat's chrome (13/20 regular, 28px chip,
   rounded-sm), so the control reads as the button it replaces. */
.dshmf-trigger {
  display: flex; align-items: center; gap: 4px; min-width: 0; max-width: 360px;
  height: 28px; padding: 0 4px 0 8px; border: none; border-radius: var(--dsw-radius-sm);
  outline: none; background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 13px; line-height: 20px; font-weight: 400; cursor: pointer;
}
@media (hover: hover) { .dshmf-trigger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); } }
.dshmf-trigger:focus-visible:not([data-selection-focus]) {
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dshmf-trigger:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.dshmf-triggerIcon { display: var(--dsh-composer-model-icon-display, none); flex: 0 0 auto; }
.dshmf-triggerText { display: var(--dsh-composer-model-text-display, block); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The trigger's label cell, whatever fills it: the shipped picker's own label
   slot (a provider's chip, its rate, its load mark) or this plugin's fallback.
   An inline-flex box keeps a chip on the text baseline instead of riding high,
   and a full-width cap lets the occupant ellipsise inside the trigger rather
   than widening it. */
.dshmf-triggerLabel { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; vertical-align: baseline; }
/* Fallback chip, matching the shipped Tag's geometry (11/17, 1px 8px, 999px)
   so a model the catalog badges looks the same whether a label occupant drew
   it or this plugin did. */
.dshmf-triggerBadge {
  flex: none; display: inline-flex; align-items: center; padding: 1px 8px;
  border-radius: 999px; corner-shape: round;
  font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary);
}
.dshmf-triggerBadge[data-tone="info"] { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent); color: var(--dsw-alias-state-business-primary); }
.dshmf-triggerBadge[data-tone="success"] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); color: var(--dsw-alias-state-success-primary); }
.dshmf-triggerBadge[data-tone="warning"] { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); color: var(--dsw-alias-state-warn-primary); }
.dshmf-triggerBadge[data-tone="danger"] { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); color: var(--dsw-alias-state-error-primary); }
.dshmf-triggerBadge[data-tone="solid"] { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }
.dshmf-triggerBadge[data-tone="outline"] { border: 0.5px solid var(--dsw-alias-border-l4); color: var(--dsw-alias-label-tertiary); }
.dshmf-triggerBadge[data-tone="quiet"] { background: transparent; color: var(--dsw-alias-label-tertiary); }
/* A model name inside the label cell: ellipsised like the shipped trigger's,
   so a long name truncates instead of pushing the chevron out. */
.dshmf-triggerName { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshmf-triggerEffort { flex-shrink: 1000; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-caption); }
.dshmf-chevron { flex: 0 0 auto; color: var(--dsw-alias-label-caption); transition: transform 120ms ease; }
.dshmf-chevronOpen { transform: rotate(180deg); }

/* Panel: the host menu surface (menu fill + blur + prominent elevation + lg
   corners), capped at 320px; only the grid scrolls. A 1px light-grey frame
   traces the panel edge in both themes — explicitly NOT a border token: the
   border-* tokens are near-invisible hairlines (see DEC-011/DEC-012), and the
   frame has to be readable on the blurred translucent surface. */
.dshmf-panel {
  box-sizing: border-box; position: fixed; z-index: 1100;
  display: flex; flex-direction: column; gap: 4px; padding: 6px;
  max-height: 320px; overflow: hidden;
  border: 1px solid #D1D5DB; border-radius: var(--dsw-radius-lg);
  background: var(--dsw-menu-surface-fill);
  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
/* The same light-grey frame, stepped to the footer divider's dark-theme grey
   (#6B7280, DEC-012) so it stays a light frame on the near-black surface
   without glaring: the width stays 1px in both themes. */
body[data-ds-dark-theme] .dshmf-panel,
html[data-ds-dark-theme] .dshmf-panel { border-color: #6B7280; }

/* Fixed sections. */
.dshmf-head { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; height: 28px; }
.dshmf-search { flex: 1 1 70%; display: flex; align-items: center; gap: 4px; min-width: 0; height: 24px; padding: 0 6px; border-radius: var(--dsw-radius-sm); }
.dshmf-search:focus-within { background: var(--dsw-alias-interactive-bg-hover); }
.dshmf-input {
  flex: 1 1 auto; min-width: 0; height: 100%; padding: 0; border: 0; outline: 0;
  background: transparent; color: var(--dsw-alias-label-primary);
  font-family: inherit; font-size: 12px; line-height: 16px;
}
.dshmf-input::placeholder { color: var(--dsw-alias-label-caption); }
@media (pointer: coarse) { .dshmf-input { font-size: 16px; } }
.dshmf-clear {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%; corner-shape: round;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.dshmf-clear:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshmf-clear:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -1px; }

.dshmf-spin {
  width: 12px; height: 12px; flex: 0 0 auto; border-radius: 50%; corner-shape: round;
  border: 1.5px solid var(--dsw-alias-border-l3); border-top-color: var(--dsw-alias-label-tertiary);
  animation: dshmf-spin 700ms linear infinite;
}
@keyframes dshmf-spin { to { transform: rotate(360deg); } }

.dshmf-seg { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 2px; padding: 2px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-interactive-bg-hover); }
.dshmf-segBtn {
  height: 22px; padding: 0 8px; border: 0; border-radius: var(--dsw-radius-xs);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-family: inherit; font-size: 11px; line-height: 16px; white-space: nowrap; cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}
.dshmf-segBtn[aria-pressed="true"] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-elevation-soft); }
@media (hover: hover) { .dshmf-segBtn:hover:not([aria-pressed="true"]) { color: var(--dsw-alias-label-primary); } }
.dshmf-segBtn:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }

.dshmf-error {
  flex: 0 0 auto; display: flex; align-items: flex-start; gap: 6px; padding: 4px 7px;
  border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary); font-size: 11px; line-height: 16px; overflow-wrap: anywhere;
}

/* The only scrolling region. Its "align-items: start" keeps the text columns
   at their natural height; a divider laid out beside them opts back into
   stretch so it spans the tallest column instead (see .dshmf-colDivider).
   Every child is placed explicitly by grid-column (and the divider by
   grid-row) — see the inline style on each one. Auto-placement must NOT be
   relied on here: a divider that pins its row but not its column is placed
   first, stealing column 1, and the columns then overflow to columns 2 and 3,
   squashing the first text column. */
.dshmf-grid {
  flex: 1 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto;
  display: grid; align-items: start;
}
.dshmf-col { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
/* When more than one column is laid out, separate adjacent columns with a
   faint vertical hairline so the eye can tell the dense model flows apart.
   The hairline is its OWN grid item, a sibling of the columns rather than a
   border on one of them: as a border it could only ever be as tall as that
   column's content. Here it sits in a dedicated gutter track and stretches to
   the grid's full height, with a small margin top and bottom.
   Only gutters that actually sit between two columns get one (see the grid
   children), so a single-column layout stays borderless. */
.dshmf-colDivider {
  grid-row: 1; align-self: stretch; justify-self: center;
  width: 1px; margin: 6px 0;
  background: var(--dsw-alias-border-l3);
}
/* Provider / family label: a filled, rounded band that reads as a section
   header, clearly separated from the model rows below it. Bare host
   group-header fill is only a few levels from the translucent panel surface.
   The band floats on an opaque grey overlay surface with soft elevation — the
   same recipe the active segment uses. It deliberately steps AWAY from the
   transparent panel surface in both themes: in light it resolves to a soft
   grey (#e9ecf2) that is visibly darker than the white panel, and in dark it
   resolves to a light grey (#61666b) that is visibly lighter than the
   near-black surface — so the band reads as a distinct section header with
   no hard-coded colour and no second theme branch (see DEC-005). Smaller but
   bold type (and the primary label colour) sets it apart from the 13px
   regular row text without borrowing from the row's interactive states.
   A hairline frame plus a short grey (border-level-3) left edge marks each
   group start: visible, never loud, and theme-neutral — no colour accent. The rows themselves
   stay borderless, so the dense flow across columns is kept (see DEC-003,
   DEC-005). */
.dshmf-groupTitle {
  align-self: flex-start; max-width: 100%; min-width: 0;
  box-sizing: border-box; height: 20px; padding: 0 8px 0 6px;
  display: flex; align-items: center;
  overflow: hidden; white-space: nowrap;
  border: 1px solid var(--dsw-alias-border-l2);
  border-left: 3px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-bg-overlay);
  box-shadow: var(--dsw-elevation-soft);
  color: var(--dsw-alias-label-primary);
  font-size: 10px; line-height: 18px; font-weight: 700; letter-spacing: .02em;
}
/* The label gets the SAME window/track split as a model row (DEC-021): the
   band is the frame, and the text inside it is a clipped window holding a
   track that can be wider than the window. That is what lets a long heading
   ("ModelScope Token Plan") run the same one-pass hover marquee as a long
   model name, while the band's frame, fill and shadow stay put (DEC-023). */
.dshmf-groupTitleWindow {
  flex: 1 1 auto; min-width: 0; display: block;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshmf-groupTitleTrack { width: max-content; max-width: none; white-space: nowrap; }
.dshmf-groupTitleTrack[data-running="true"] {
  display: inline-block;
  animation: dshmf-rowNameMarquee var(--dshmf-marquee-duration, 3000ms) ease-in-out 1 forwards;
}
.dshmf-row {
  box-sizing: border-box; display: flex; align-items: center; gap: 6px; width: 100%;
  height: 26px; padding: 0 6px; border: 0; border-radius: var(--dsw-radius-sm);
  background: transparent; color: var(--dsw-alias-label-primary);
  font-family: inherit; font-size: 13px; line-height: 18px; font-weight: 400; text-align: left;
  cursor: pointer; min-width: 0;
}
@media (hover: hover) { .dshmf-row:hover:not(:disabled):not([aria-pressed="true"]) { background: var(--dsw-alias-interactive-bg-hover); } }
.dshmf-row:focus-visible { background: var(--dsw-alias-interactive-bg-hover); outline: none; }
.dshmf-row:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
/* Selected model: a solid deep-blue band with white bold text — the row
   itself says "this one is active", so no checkmark and no reserved tail
   column is needed (that 14px sat empty on every unselected row).
   The pairing is pinned to the static deepseek-600 + white rather than the
   alias --dsw-alias-state-business-primary, because that alias flips to a
   LIGHT blue with dark text in the dark theme; the request is a deep blue
   with white text in both themes, and these two static tokens are the same
   in light and dark. */
.dshmf-row[aria-pressed="true"],
.dshmf-row[aria-pressed="true"]:focus-visible {
  background: var(--dsw-static-deepseek-600);
  color: var(--dsw-static-neutral-bluish-00);
  font-weight: 600;
}
.dshmf-row[aria-pressed="true"] .dshmf-rowProvider { color: inherit; opacity: .82; }
.dshmf-row[aria-pressed="true"] .dshmf-badge {
  background: color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 22%, transparent);
  color: inherit;
}
.dshmf-rowNameWindow {
  flex: 1 1 auto; min-width: 0; display: block;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* The name itself never ellipsises on its own: the window clips it, and the
   track is what slides when the pointer rests on a truncated row (DEC-021).
   width: max-content is what lets the track be wider than the window, which is
   both the overflow signal (scrollWidth) and what the marquee reveals. */
.dshmf-rowName {
  width: max-content; max-width: none;
  white-space: nowrap;
}
/* Resting the pointer on a row whose name does not fit starts ONE marquee
   pass: the name glides left until its last glyph reaches the window, then
   STOPS there. The easing is ease-in-out, so the start and the arrival are
   soft rather than a constant crawl. Only the name TRACK moves — the window
   clips it, so the right-aligned badge (限时免费, ×0.1) and the pending
   spinner, which sit as siblings AFTER the window, never shift. There is no
   return trip and no iteration: fill-mode forwards holds the end state, and
   leaving the row drops the animation entirely, which snaps back with no
   transition. */
@keyframes dshmf-rowNameMarquee {
  from { transform: translateX(0); }
  to { transform: translateX(var(--dshmf-marquee-shift)); }
}
.dshmf-rowNameTrack[data-running="true"] {
  display: inline-block;
  animation: dshmf-rowNameMarquee var(--dshmf-marquee-duration, 3000ms) ease-in-out 1 forwards;
}
@media (prefers-reduced-motion: reduce) {
  .dshmf-rowNameTrack[data-running="true"],
  .dshmf-groupTitleTrack[data-running="true"] { animation: none; }
}
/* The model's last call failed on insufficient balance / credit / quota, and no
   later call for the same model has cleared it, nor has the mark aged past
   STRIKE_TTL (24h) without a fresh attempt. The row text is struck through
   rather than recoloured: the strike survives both themes and the selected
   row's blue band, and it does not compete with the error strip's own red.
   The decoration is applied to the row's text only (name + variant tag), not
   to the badge chip or the spinner. */
.dshmf-row[data-insufficient="true"] .dshmf-rowName,
.dshmf-row[data-insufficient="true"] .dshmf-rowProvider {
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}
/* A multiplier marker lifted out of the model name (rate/size tags like
   "x0.01", "x1.5", "X 2.2"). The characters stay in place and the full name is
   unchanged; only this run is drawn two sizes smaller and bold, so the
   multiplier reads as an aside without disturbing the row's text rhythm
   (see renderRow's nameRuns). */
.dshmf-rowNameMark { font-size: 11px; line-height: 18px; font-weight: 700; letter-spacing: normal; }
/* The model-specific tail of a family-grouped row, e.g. "3.8-Flash-Next",
   "V4.1-Flash · x0.01", "2.1 Turbo". The primary text is the provider and the
   heading names the family, so this is what is LEFT after both are removed —
   the型号 and the multiplier the heading cannot carry (DEC-023). It sits at
   the END of the row and is quieter than the primary text (caption colour,
   11px), shrinks before it, and never wraps. No width cap: a cap truncates a
   perfectly readable label ("CodeBuddy …") in a column that had room for it. */
.dshmf-rowProvider {
  flex: 0 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-caption);
  font-size: 11px; line-height: 16px; font-weight: 400;
}
/* A multiplier inside that tail ("x0.01") keeps the same "smaller and bolder"
   treatment it gets inside a model name in *By provider* (see
   .dshmf-rowNameMark and renderRow's nameRuns), so the rate reads identically
   in both grouping modes. The base rule already makes it bold and 11px; inside
   the 11px tail it steps down once more, to 10px, to stay visibly apart. */
.dshmf-rowProvider .dshmf-rowNameMark { font-size: 10px; line-height: 16px; }
.dshmf-rowTail { display: grid; place-items: center; flex: 0 0 14px; color: inherit; }

/* Catalog badge (for example a third-party rate multiplier). Rendered only
   when the catalog publishes text, so a badge-less model keeps no gap. */
.dshmf-badge {
  flex: none; display: inline-flex; align-items: center; padding: 0 6px;
  border-radius: 999px; corner-shape: round;
  font-size: 10px; line-height: 16px; font-weight: 500; white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary);
}
.dshmf-badge[data-tone="info"] { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent); color: var(--dsw-alias-state-business-primary); }
.dshmf-badge[data-tone="success"] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); color: var(--dsw-alias-state-success-primary); }
.dshmf-badge[data-tone="warning"] { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); color: var(--dsw-alias-state-warn-primary); }

.dshmf-empty { grid-column: 1 / -1; padding: 10px 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dshmf-failure { grid-column: 1 / -1; padding: 2px 6px; color: var(--dsw-alias-state-warn-label); font-size: 11px; line-height: 16px; overflow-wrap: anywhere; }

/* Adaptive footer: the reasoning group and the teamwork group share one line
   when BOTH fit side by side with a guaranteed 30px gap, and otherwise fall
   back to one row each (the original two-line look). The decision is pure CSS:
   the footer stretches to the panel width, each child keeps its natural
   max-content width (flex 0 0 auto), and flex-wrap plus a 30px column-gap
   puts them on one line exactly when reason + 30 + team <= panel width.
   No JS width guessing, so it stays correct across panel resize, theme and
   font changes. A max-width of 100% lets a child that ends up alone on a line
   cap to the panel width and wrap internally instead of overflowing.
   The divider sits on this container, not on a child (DEC-016): the two groups
   can share a line or stack, and either way the rule belongs above the whole
   footer block, never between them, so no child carries a border. Host border
   tokens are faint by design, so the line uses explicit greys: medium grey on
   the light panel, a lighter near-white grey on the dark panel. */
.dshmf-footer {
  flex: 0 0 auto; display: flex; align-items: center; flex-wrap: wrap;
  column-gap: 30px; row-gap: 4px;
  border-top: 1px solid #9CA3AF;
  padding-top: 6px;
}
body[data-ds-dark-theme] .dshmf-footer,
html[data-ds-dark-theme] .dshmf-footer { border-top-color: #6B7280; }

/* Display-mode button: the footer's trailing member, pinned to the panel's
   bottom-right by an auto left margin. Drawn with the panel's own segment
   recipe (toned track, 2px inset, radius-xs) so it reads as the same design
   system as the header grouping control and the reasoning levels, and so the
   pressed state is unmistakable in both themes. The auto margin also survives
   the wrap case: alone on its line it still sits right. */
.dshmf-modeBtn {
  flex: 0 0 auto; margin-left: auto;
  height: 22px; padding: 0 8px; border: 0; border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  font-family: inherit; font-size: 11px; line-height: 16px; font-weight: 400;
  white-space: nowrap; cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}
@media (hover: hover) { .dshmf-modeBtn:hover:not(:disabled):not([aria-pressed="true"]) { color: var(--dsw-alias-label-primary); } }
.dshmf-modeBtn[aria-pressed="true"] {
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-elevation-soft); font-weight: 500;
}
.dshmf-modeBtn:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.dshmf-modeBtn:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }

/* The bottom action that brings the panel back from native mode. It occupies
   the HOST picker's own root-menu slot (conversation.input.model.options), which
   renders its occupants after the Model / Effort rows. The slot hands us a bare
   display: contents anchor, so the box below is entirely ours to draw: it is
   deliberately NOT a menu-row clone. A row in this menu means "one of a set of
   values, pick one" — this control does something else, so it separates itself
   with a rule above and presents as a compact, out-lined push button.
   The band spans the FULL row width (the menu already pads 4px, and a row's
   hover fill spans that same width), so it carries no horizontal padding of its
   own: the button's edges line up with the rows above it instead of sitting a
   few pixels inside them. */
.dshmf-modeAction {
  box-sizing: border-box; display: flex; align-items: center;
  width: auto; min-width: 100%; margin-top: 2px; padding: 7px 0 1px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dshmf-modeBtnRow {
  box-sizing: border-box; display: flex; align-items: center; justify-content: center;
  gap: 6px; width: 100%; height: 30px; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm);
  outline: none; background: transparent; color: var(--dsw-alias-label-primary);
  font-family: inherit; font-size: 12px; line-height: 18px; font-weight: 500;
  white-space: nowrap; cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.dshmf-modeBtnRowIcon { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
.dshmf-modeBtnRowLabel { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dshmf-modeBtnRow:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
@media (hover: hover) {
  .dshmf-modeBtnRow:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    border-color: var(--dsw-alias-border-l4);
  }
}

/* Reasoning levels: a caption and a multi-segmentation control on one line;
   the track wraps below the caption only when the row cannot fit. The
   segment visual mirrors the header's grouping control, so the panel has
   one visual language for "one of many, exactly one active". */
.dshmf-reason {
  flex: 0 0 auto; display: flex; align-items: center; flex-wrap: wrap;
  gap: 2px 6px; max-width: 100%;
}
.dshmf-reasonLabel {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px; line-height: 16px; font-weight: 500;
}
.dshmf-reasonLabel svg { flex: 0 0 auto; }
.dshmf-pills {
  flex: 0 0 auto; max-width: 100%;
  display: inline-flex; align-items: center; gap: 2px;
  padding: 2px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-interactive-bg-hover);
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
}
.dshmf-pills::-webkit-scrollbar { height: 0; }
.dshmf-pill {
  flex: 0 0 auto; height: 22px; padding: 0 8px; border: 0;
  border-radius: var(--dsw-radius-xs);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-family: inherit; font-size: 11px; line-height: 16px; font-weight: 400; white-space: nowrap; cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}
@media (hover: hover) { .dshmf-pill:hover:not(:disabled):not([aria-checked="true"]) { color: var(--dsw-alias-label-primary); } }
.dshmf-pill[aria-checked="true"] {
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-elevation-soft); font-weight: 500;
}
.dshmf-pill:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.dshmf-pill:disabled[aria-checked="true"] { opacity: .5; }
.dshmf-pill:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }

/* Teamwork row: label, info button and switch all left-aligned on one line,
   so the switch sits immediately to the right of the title. */
.dshmf-team {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-start; gap: 8px;
  max-width: 100%;
  min-height: 30px; padding: 0 6px;
  color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px;
}
.dshmf-teamLabel { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.dshmf-teamName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshmf-info {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; color: var(--dsw-alias-label-caption);
}
.dshmf-switch {
  box-sizing: border-box; position: relative; flex: 0 0 auto; width: 36px; height: 20px; padding: 2px;
  border: 0; border-radius: 999px; corner-shape: round; background: var(--dsw-alias-border-l3); cursor: pointer;
}
.dshmf-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }
.dshmf-switch:disabled { cursor: default; opacity: .5; }
.dshmf-switch:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dshmf-thumb { display: block; width: 16px; height: 16px; border-radius: 50%; corner-shape: round; background: var(--dsw-alias-label-primary-foreground); transition: transform .12s ease; }
.dshmf-switch[aria-checked="false"] .dshmf-thumb { background: var(--dsw-alias-switch-thumb); }
.dshmf-switch[aria-checked="true"] .dshmf-thumb { transform: translate(16px); }

/* Inline disable confirmation, with the host's confirmation copy. */
.dshmf-confirm { flex: 0 0 auto; display: flex; flex-direction: column; gap: 3px; padding: 6px 8px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-module-platform); }
.dshmf-confirmTitle { color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; font-weight: 500; }
.dshmf-confirmBody { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
.dshmf-confirmActions { display: flex; justify-content: flex-end; gap: 6px; }
.dshmf-confirmBtn { height: 22px; padding: 0 9px; border: 0; border-radius: var(--dsw-radius-xs); background: transparent; color: var(--dsw-alias-label-secondary); font-family: inherit; font-size: 11px; line-height: 16px; cursor: pointer; }
.dshmf-confirmBtn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshmf-confirmBtn[data-primary="true"] { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }
.dshmf-confirmBtn:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }

/* Off-screen probe: measures one group title and one model row at the real
   font scale, so column fit uses this browser's metrics, not a guess. */
.dshmf-probe { position: absolute; top: 0; left: 0; width: 160px; height: 0; overflow: hidden; visibility: hidden; pointer-events: none; }

@media (prefers-reduced-motion: reduce) {
  .dshmf-spin { animation-duration: 2s; }
  .dshmf-thumb, .dshmf-chevron, .dshmf-pill, .dshmf-segBtn { transition: none; }
}
`
    const STYLE_TAG = 'dsh-model-flatmap/panel.css'
    const STYLE_OWNER = 'dsh-model-flatmap'
    if (typeof document !== 'undefined'
      && document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG)}]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = STYLE_OWNER
      tag.dataset.pluginCss = STYLE_TAG
      tag.textContent = CSS
      document.head.append(tag)
    }

    // ---------------------------------------------------------------------
    // Constants and helpers
    // ---------------------------------------------------------------------
    const PANEL_MAX = 320
    const PANEL_PAD = 6
    const PANEL_GAP = 4
    const COL_GAP = 10
    const ROW_GAP = 2
    const BALANCE_THRESHOLD = 24

    /**
     * The band a re-measurement must leave before it counts as a real layout
     * change (DEC-026). Two physical pixels: smaller than anything the column
     * plan acts on (its smallest unit is a 26px row), larger than the
     * scrollbar / flex-wrap jitter that would otherwise re-plan the panel from
     * its own output.
     */
    const METRIC_HYSTERESIS = 2

    /**
     * The height quantum a measurement is snapped to (DEC-026).
     *
     * `getBoundingClientRect().height` and `offsetHeight` are physical pixels:
     * a web font swapping in, a scrollbar appearing, or a flex container
     * re-rounding can move them by a fraction of a pixel between two frames
     * that render the same visual layout. Because the measured value feeds back
     * into the panel's own column plan, taking such noise literally makes the
     * panel oscillate. Half a pixel is below anything the layout acts on
     * (the smallest thing it decides is a 26px row), so snapping both the
     * comparison and the stored value to it absorbs the noise while keeping
     * every real change — a wrapped footer, a shown error strip.
     * @param {number} value - a raw measured height in px.
     * @returns {number} the height snapped to the nearest half pixel.
     */
    const quantizeMetric = value => {
      const numeric = Number(value)
      if (!Number.isFinite(numeric) || numeric <= 0) return 0
      return Math.round(numeric * 2) / 2
    }

    /**
     * Is a new measurement meaningfully different from the stored one (DEC-026)?
     *
     * Measurement feeds the panel's own column plan, and the plan feeds the
     * panel's layout, so this comparison is the loop's control point: it must
     * answer "no" for anything that is not a real change. A 2px band absorbs
     * the one thing quantization cannot — the footer's CSS flex wrapping
     * flipping back and forth across a scrollbar boundary, which moves the
     * measured block by a couple of pixels in either direction but draws the
     * same panel. Real transitions (a footer wrapping at all, an error strip
     * appearing) move the value far outside the band.
     * @param {number} previous - the stored measurement.
     * @param {number} next - the freshly measured one.
     * @returns {boolean} true when the difference is worth a re-plan.
     */
    const metricChanged = (previous, next) => {
      if (previous === next) return false
      return Math.abs(next - previous) >= METRIC_HYSTERESIS
    }

    const PATH_CHEVRON = 'M3.2 5.6 7 9.4 10.8 5.6'
    const PATH_CLOSE = 'M4 4 10 10M10 4 4 10'
    const PATH_INFO = 'M7 6.4v4.1M7 3.7v.8'
    const PATH_SPARK = 'M7 1.6 8.3 5.7 12.4 7 8.3 8.3 7 12.4 5.7 8.3 1.6 7 5.7 5.7 7 1.6Z'
    const PATH_MODELS = 'M7 2.1 11.9 4.7 7 7.3 2.1 4.7 7 2.1Zm-4.9 5.1L7 9.8l4.9-2.6M2.1 10.3 7 12.9l4.9-2.6'
    /* Four tiles: the flat panel this control returns to, so the icon names the
       DESTINATION rather than repeating the model glyph above it. */
    const PATH_GRID = 'M2.4 2.4h3.6v3.6H2.4zM8 2.4h3.6v3.6H8zM2.4 8h3.6v3.6H2.4zM8 8h3.6v3.6H8z'

    function svg(path, size, extra) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 14 14', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false', ...extra,
      }, h('path', { d: path }))
    }

    /** Resolve provider-authored catalog text without the locale service. */
    function fallbackText(value) {
      return typeof value === 'string' ? value : (value?.en ?? '')
    }

    function fill(t, key, values) {
      const template = String(t(key))
      if (values === undefined) return template
      return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''))
    }

    /**
     * A provider's display label, resolved from the catalog's own name.
     *
     * Extracted so the trigger's label seat and the panel's group headings
     * cannot drift: both hand the label slot the same `provider.name`, and a
     * heading that said "豆包(doubao)" while the trigger said "Doubao" would be
     * two spellings of one provider on one screen.
     * @param {{id: string, name: unknown}} group - one provider entry.
     * @param {Function} t - the panel's own translate seat.
     * @param {Function|undefined} resolveText - the host's catalog-text resolver.
     * @returns {string} a display-ready label; never empty.
     */
    function providerLabel(group, t, resolveText) {
      if (group.id === 'deepseek-account') return t('provider.account')
      const resolved = resolveText === undefined ? undefined : resolveText(group.name)
      if (typeof resolved === 'string' && resolved.trim() !== '') return resolved
      const fallback = fallbackText(group.name)
      return fallback.trim() === '' ? group.id : fallback
    }

    /**
     * Split a raw query into lowercase search tokens. Whitespace separates
     * tokens, so `mod inte` asks for `mod` AND `inte` rather than for that
     * literal string — which is what lets it find `ModelScope International`,
     * a name the two words never appear in contiguously.
     * @param {string} query - raw search text.
     * @returns {string[]} lowercase, non-empty tokens.
     */
    function searchTokens(query) {
      const raw = typeof query === 'string' ? query : ''
      return raw.trim().toLowerCase().split(/\s+/).filter(token => token !== '')
    }

    /**
     * Rank ONE token against one name: prefix beats substring beats ordered
     * subsequence. This is the original single-term ranking, unchanged.
     * @param {string} name - lowercase haystack.
     * @param {string} token - lowercase needle.
     * @returns {0|1|2|null} the rank, or null when the token is absent.
     */
    function tokenScore(name, token) {
      if (name.startsWith(token)) return 0
      if (name.includes(token)) return 1
      let at = 0
      for (const ch of token) {
        at = name.indexOf(ch, at)
        if (at === -1) return null
        at += 1
      }
      return 2
    }

    /**
     * Case-insensitive match: prefix beats substring beats ordered subsequence.
     *
     * A query may hold several whitespace-separated tokens. Every token then
     * has to land somewhere in the name, and the result takes the weakest of
     * them — so `mod inte` finds `ModelScope International`, while `mod zzz`
     * still finds nothing. A single token keeps the original ranking exactly,
     * so existing ordering does not shift.
     */
    function matchScore(name, query) {
      const tokens = searchTokens(query)
      if (tokens.length === 0) return 0
      const n = String(name ?? '').toLowerCase()
      if (tokens.length === 1) return tokenScore(n, tokens[0])
      let weakest = 0
      for (const token of tokens) {
        const score = tokenScore(n, token)
        if (score === null) return null
        if (score > weakest) weakest = score
      }
      return weakest
    }

    /**
     * Rank of a model that is shown because its PROVIDER matched the query
     * rather than its own name. Sorts after every name hit; the sort is stable,
     * so models pulled in this way keep their catalog order.
     */
    const PROVIDER_MATCH = 3

    // ---------------------------------------------------------------------
    // Insufficient balance / credit / quota — the per-model strike state.
    //
    // The Host already classifies an exhausted account (rather than a
    // transient rate limit) into the provider-neutral `QUOTA` and
    // `ACCOUNT_QUOTA` failure codes, and a provider HTTP 402 maps to `QUOTA`
    // (dsh-llm/src/error.ts `isQuotaExceededError`, dsh-llm-deepseek
    // `providerError`). Those facts reach the Client on the durable
    // `turn/end` event as `reason.error` = `{ code, message, status? }`, so the
    // panel does not need a Host change: it folds the session event feed.
    //
    // The wording pass exists because a failure can be flattened to a
    // transient-looking code with the provider's text kept in `message`. The
    // provider-status code is NOT authoritative for the account state: several
    // providers answer an exhausted balance with **HTTP 429** rather than 402 —
    // e.g. `429: {"message":"insufficient balance","request_id":"…"}` — and the
    // Host classifies that as `RATE_LIMIT`, which is normally transient. The
    // message therefore has to decide in that case, so a 429 with balance
    // wording strikes while a 429 that is a real rate limit does not.
    //
    // The wording pass is deliberately narrow: a bare "402"/"429" only counts
    // when it reads as the leading status, never as a number inside another
    // message, and every example below is taken from a real recorded session.
    //
    // A strike also EXPIRES. Every record keeps the wall-clock moment the
    // observation was made, which is what lets the panel tell "this model is out
    // of balance" apart from "this model has not been tried since that verdict".
    // Quotas reset daily and balances get topped up, so a strike that nobody
    // refreshed stops being drawn after STRIKE_TTL; a retry that fails again
    // re-stamps the record and restarts the window, and a retry that answers
    // clears it outright. The window is therefore always "24h since the newest
    // thing we learned about this route", not "24h since the row was drawn".
    // ---------------------------------------------------------------------

    /** Failure codes that mean "this account has no usable balance left". */
    const INSUFFICIENT_CODES = new Set([
      'QUOTA', 'ACCOUNT_QUOTA', 'INSUFFICIENT_QUOTA', 'INSUFFICIENT_BALANCE', 'BUDGET_EXHAUSTED',
    ])

    /**
     * Provider wording for an exhausted balance, credit, or account quota.
     * Mirrors the Host's own classifier so the panel and the Chat's quota notice
     * agree about what counts, plus the provider-specific shapes seen in real
     * sessions (the Host's regexes are not importable from a browser bundle).
     */
    const INSUFFICIENT_TEXT = [
      // "insufficient balance" / "insufficient_balance_error" / "insufficient credits".
      /\binsufficient[\s_-]+(?:quota|balance|credits?|funds?|user[\s_-]+quota)\b/i,
      // "quota exceeded" / "usage limit reached" / "quota_exceeded".
      /\b(?:quota|usage[\s_-]+limit)[\s_-]+(?:exceeded|exhausted|reached)\b/i,
      // "exceeded your current quota".
      /\bexceed(?:ed|s)?[\s_-]+(?:(?:your|the)[\s_-]+)?(?:current[\s_-]+)?quota\b/i,
      // "balance exhausted" / "credits depleted" / "credit too low".
      /\b(?:balance|credits?)[\s_-]+(?:exhausted|depleted|too[\s_-]+low)\b/i,
      // "out of credits" / "out of budget".
      /\bout[\s_-]+of[\s_-]+(?:credits?|budget|balance)\b/i,
      // "no credits remaining" (OpenAI) / "no available balance".
      /\bno[\s_-]+(?:available[\s_-]+)?(?:credits?|balance|quota)\b/i,
      /\bno[\s_-]+credits?[\s_-]+remaining\b/i,
      // "Not enough quota to pre-consume" (new-api gateways).
      /\bnot[\s_-]+enough[\s_-]+quota\b/i,
      // "doesn't have any credits or licenses yet" (xAI).
      /\b(?:any|no)[\s_-]+credits?[\s_-]+or[\s_-]+licen[cs]es?\b/i,
      // "Billing daily count exceeded" / billing hard limit.
      /\bbilling[\s_-]+(?:daily[\s_-]+count[\s_-]+exceeded|hard[\s_-]+limit)\b/i,
      // "Your requests have exceeded the quota" / "quota is exhausted" (Trae).
      /\bquota[\s_-]+is[\s_-]+exhausted\b/i,
      /\brequests?[\s_-]+have[\s_-]+exceeded[\s_-]+the[\s_-]+quota\b/i,
      /\bpayment[\s_-]+required\b/i,
      // Chinese provider wording: 额度已用尽 / 余额不足 / 预算已用完 / 欠费.
      /额度不足|余额不足|额度已用尽|余额已用尽|欠费|账户余额|额度已耗尽/,
      /(?:预算|额度)[^。；;]{0,12}(?:已用完|已用尽|不足|耗尽)/,
    ]

    /**
     * Decide whether one recorded failure means the account ran out of
     * balance rather than hitting a transient limit.
     *
     * A structured balance code is authoritative. A provider status of `402`
     * ("payment required") is too. **`429` is NOT authoritative either way:**
     * some providers report an exhausted balance with 429 and a body that says
     * so (`429: {"message":"insufficient balance",…}`), which the Host
     * classifies as `RATE_LIMIT`. For every other case the message decides, so
     * a 429 carrying balance wording strikes while a genuine rate limit does
     * not.
     * @param {unknown} error - a `turn/end` `reason.error` (`{ code, message, status }`), or a thrown value.
     * @returns {boolean} true only for an exhausted balance, credit, or quota.
     */
    function isInsufficientBalance(error) {
      if (error === null || typeof error !== 'object') {
        return typeof error === 'string' ? INSUFFICIENT_TEXT.some(pattern => pattern.test(error)) : false
      }
      const code = typeof error.code === 'string' ? error.code.toUpperCase() : ''
      if (INSUFFICIENT_CODES.has(code)) return true
      // A provider status of 402 means "payment required", which in practice is
      // the account running dry. The structured `status` field is preferred; a
      // code shaped `HTTP_402` carries the same fact.
      if (error.status === 402 || code === 'HTTP_402') return true
      // A 429 (or any other status) is decided by the text: providers use 429
      // for BOTH a transient rate limit and an exhausted balance.
      const message = typeof error.message === 'string' ? error.message : ''
      if (INSUFFICIENT_TEXT.some(pattern => pattern.test(message))) return true
      // `insufficient_user_quota` and friends can arrive only as a structured
      // code inside the message body rather than as the failure code.
      return /\binsufficient[\s_-]+user[\s_-]+quota\b/i.test(message)
    }

    /**
     * Stable identity of one model route. The strike state is keyed by route,
     * not by row, because the same model appears under both grouping modes and
     * a provider may publish the same id under two groups.
     * @param {unknown} provider - provider id.
     * @param {unknown} model - provider-owned model id.
     * @returns {string} the composite key.
     */
    function routeKeyOf(provider, model) {
      return `${String(provider ?? '')}/${String(model ?? '')}`
    }

    /**
     * Turn endings that PROVE the model route answered, so a standing
     * insufficient-balance mark must end. A cancellation (`aborted`) or a turn
     * closed before any request ran (`blocked`, and the synthetic
     * `interrupted` / `forked` closers) proves nothing about the account — the
     * model never answered — so those leave the mark alone.
     */
    const CLEARING_TURN_ENDS = new Set(['completed', 'max-tokens', 'error'])

    /**
     * Wall-clock time one durable event was recorded at. The Client feed keeps
     * the Host's `time` (`Date.now()` at append), which is what lets marks
     * gathered from DIFFERENT Sessions be ordered against each other — a Session
     * feed has no cross-Session sequence number — and it is the same clock the
     * strike lifetime is measured against.
     *
     * An event with no stamp is an observation made NOW, not one made at the
     * epoch: folding it as `0` would file a fact we just learned as 56 years old
     * and a strike could never be drawn for it.
     * @param {unknown} event - one durable Session event.
     * @returns {number} the event time, or the current time when the feed carried none.
     */
    function eventTimeOf(event) {
      const time = event?.time
      return typeof time === 'number' && Number.isFinite(time) ? time : Date.now()
    }

    /**
     * Decide what ONE durable event says about a model route's balance, with no
     * state involved. This is the whole semantic core of the feature, kept
     * separate from the bookkeeping so it can be pinned directly.
     *
     * - A `turn/end` that failed on insufficient balance → `true` (mark).
     * - A `turn/end` that proves the model answered otherwise → `false`
     *   (clear): a completed turn, a `max-tokens` turn, or a turn that failed
     *   for a different reason.
     * - A cancellation (`aborted`), a `blocked` turn, and the synthetic
     *   `interrupted` / `forked` closers → `null` (no decision), because the
     *   model never answered and the account state is unknown.
     * - Anything that is not a `turn/end`, or has no route → `null`.
     * @param {unknown} event - one durable Session event.
     * @param {{ provider: string, model: string } | null} route - the route that request used.
     * @returns {boolean | null} mark, clear, or no decision.
     */
    function decideMark(event, route) {
      if (event === null || typeof event !== 'object') return null
      if (event.type !== 'turn/end' || route === null || route === undefined) return null
      const reason = event.data?.reason
      if (reason === null || typeof reason !== 'object') return null
      if (reason.kind === 'error') return isInsufficientBalance(reason.error)
      return CLEARING_TURN_ENDS.has(reason.kind) ? false : null
    }

    /**
     * Fold ONE decision into the mark map, last-writer-wins by event time.
     *
     * The time watermark is what makes the state GLOBAL and replay-safe: marks
     * arrive from every Session's feed (and from storage written by an earlier
     * page load), so the newest observation wins no matter which Session it came
     * from. Re-walking an old window therefore cannot resurrect a mark that a
     * later call already cleared, and a cleared route keeps a watermark so a
     * stale replay stays a no-op.
     * @param {Map<string, {marked: boolean, at: number}>} entries - state, mutated in place.
     * @param {string} key - the route key.
     * @param {boolean} marked - the decision this event carries.
     * @param {number} at - the event's time.
     * @returns {{ visible: boolean, stored: boolean }} whether the visible mark
     *   set changed, and whether the underlying record changed.
     */
    function foldMarkEntry(entries, key, marked, at) {
      const previous = entries.get(key)
      if (previous !== undefined && at < previous.at) {
        return { visible: false, stored: false }
      }
      if (previous !== undefined && previous.marked === marked && previous.at === at) {
        return { visible: false, stored: false }
      }
      entries.set(key, { marked, at })
      return { visible: previous === undefined ? marked : previous.marked !== marked, stored: true }
    }

    /**
     * Fold one durable event into the mark map. Pure helper kept for the tests
     * and for callers that hold their own map; the live store uses
     * {@link decideMark} + {@link foldMarkEntry} so it can batch persistence.
     * @param {Map<string, {marked: boolean, at: number}>} state - state, mutated in place.
     * @param {unknown} event - one durable Session event.
     * @param {{ provider: string, model: string } | null} route - the route that request used.
     * @param {number} [at] - the event's time; defaults to `event.time`.
     * @returns {boolean} whether the visible mark set changed.
     */
    function foldInsufficient(state, event, route, at) {
      const marked = decideMark(event, route)
      if (marked === null) return false
      const key = routeKeyOf(route.provider, route.model)
      const time = at === undefined ? eventTimeOf(event) : at
      return foldMarkEntry(state, key, marked, time).visible
    }

    /**
     * Resolve the model route a request header names. The header's `config` is
     * an `LlmCallConfig` (`{ provider, model, ... }`).
     * @param {unknown} event - one durable Session event.
     * @returns {{ provider: string, model: string } | null} the route, or null when this event is not a usable header.
     */
    function routeOfHeader(event) {
      if (event === null || typeof event !== 'object' || event.type !== 'request/header') return null
      const config = event.data?.header?.config
      if (config === null || typeof config !== 'object') return null
      if (typeof config.provider !== 'string' || typeof config.model !== 'string') return null
      return { provider: config.provider, model: config.model }
    }

    /**
     * Every searchable face of a provider-authored text: a plain string is one
     * face, a localized object contributes each language it carries. Provider
     * names arrive localized (`{ zh: '豆包(doubao)', en: 'Doubao' }`), so the
     * search has to see all of them — matching only the English face would make
     * the Chinese name unsearchable.
     * @param {unknown} value - a string, or a localized record of strings.
     * @returns {string[]} lowercased, non-empty faces.
     */
    function textFaces(value) {
      if (typeof value === 'string') return [value.toLowerCase()].filter(text => text !== '')
      if (value === null || typeof value !== 'object') return []
      const faces = []
      for (const face of Object.values(value)) {
        if (typeof face !== 'string') continue
        const text = face.toLowerCase()
        if (text !== '') faces.push(text)
      }
      return faces
    }

    /**
     * Match the query against the provider itself — its id, its catalog name,
     * and the label its section draws. A hit means "this vendor was asked for",
     * so the whole catalog of that provider is listed: typing `dou` finds the
     * `豆包(doubao)` provider and every model under it, including the ones whose
     * own names never contain the query.
     *
     * A multi-token query matches the provider when every token lands in SOME
     * face of the same provider, so `mod inte` finds a provider named
     * `ModelScope International` even though those words are never contiguous.
     * Tokens may land in different faces — the id answers `mod`, the localized
     * name answers `inte`.
     *
     * Only prefix and substring are considered per token. A subsequence pass —
     * which `matchScore` allows for model names — would let a two-letter query
     * light up every provider in the directory, which is noise rather than a
     * match.
     * @param {{id?: string, name?: unknown}} group - one provider entry.
     * @param {string} query - raw search text.
     * @param {unknown} [title] - the label this provider's section draws.
     * @returns {0|1|null} 0 for a prefix hit, 1 for a substring hit, else null.
     */
    function providerScore(group, query, title) {
      const tokens = searchTokens(query)
      if (tokens.length === 0) return null
      const texts = [...textFaces(group?.id), ...textFaces(group?.name), ...textFaces(title)]
      if (texts.length === 0) return null
      /** The best rank one token reaches across every face. */
      const rankOf = token => {
        let best = null
        for (const text of texts) {
          const rank = text.startsWith(token) ? 0 : text.includes(token) ? 1 : null
          if (rank === null) continue
          if (best === null || rank < best) best = rank
          if (best === 0) return 0
        }
        return best
      }
      let weakest = 0
      for (const token of tokens) {
        const rank = rankOf(token)
        if (rank === null) return null
        if (rank > weakest) weakest = rank
      }
      return weakest
    }

    // ---------------------------------------------------------------------
    // Model families: hard-coded dictionary → id-derived guess → Others.
    // Families stay flat; Others always sorts last. A family is a BRAND, and
    // a *registered* brand keeps its GENERATIONS apart: `hy3` is `HY3`,
    // `hy4-preview`/`hy4free`/`hy4std` are `HY4`, while a bare `hy` is `HY`.
    // Unregistered brands still collapse their version tail (`acme4-turbo`
    // and `acme-7b` are one `Acme`). Dictionary families never split.
    // ---------------------------------------------------------------------
    const FAMILY_DICTIONARY = [
      ['DeepSeek', ['deepseek']],
      ['Grok', ['grok']],
      ['Opus', ['opus']],
      ['Haiku', ['haiku']],
      ['Sonnet', ['sonnet']],
      ['Claude', ['claude']],
      ['Qwen', ['qwen', 'qwq']],
      ['GLM', ['glm', 'chatglm']],
      ['Kimi', ['kimi', 'moonshot']],
      ['GPT', ['gpt', 'chatgpt', 'o1-', 'o3-', 'o4-']],
      ['Gemini', ['gemini', 'gemma']],
      ['Llama', ['llama']],
      ['Mistral', ['mistral', 'mixtral', 'codestral']],
      ['Doubao', ['doubao', 'seed-']],
      ['MiniMax', ['minimax', 'abab']],
      ['Hunyuan', ['hunyuan']],
      ['ERNIE', ['ernie']],
      ['Yi', ['yi-', '01-ai']],
      ['Phi', ['phi-']],
      ['Command', ['command-r']],
      ['Nova', ['nova-']],
      ['Step', ['step-']],
    ]
    const OTHERS = 'Others'
    const FAMILY_ALIASES = new Map([
      ['gpt', 'GPT'], ['glm', 'GLM'], ['qwen', 'Qwen'], ['kimi', 'Kimi'],
    ])
    const VERSION_ONLY = /^(v|ver|r)?\d+([.-]\d+)*$/i
    /**
     * A brand token plus its version tail: `hy3`, `hy4-preview`, `hy4free`,
     * `qwen2.5`. Group 1 is the brand, group 2 the leading generation digit(s)
     * (captured so registered brands can keep generations apart), group 3 the
     * rest of the variant tail.
     */
    const BRAND_WITH_VERSION = /^([a-z][a-z]*?)(\d+)([\w.-]*)$/i
    /**
     * Registered brands, mapped to their exact heading casing. Sort with the
     * dictionary families instead of after them. `HY` is the case that
     * prompted this: its ids (`hy3`, `hy4-preview`, `hy4free`) share no name
     * needle, and the brand is an acronym the generic title-casing would draw
     * as `Hy`. A registered brand's family is `BRAND + generation` when the id
     * carries a generation digit (so `hy3` → `HY3`, `hy4free` → `HY4`), and
     * the bare brand otherwise (`hy` → `HY`). Dictionary families are never
     * split by generation.
     */
    const FAMILY_BRANDS = new Map([['hy', 'HY']])
    const FAMILY_ORDER = [
      ...FAMILY_DICTIONARY.map(entry => entry[0]),
      ...FAMILY_BRANDS.values(),
    ]

    /**
     * Split one versioned id token into its brand / generation / variant tail.
     * @param {string} token - one lowercased id segment.
     * @returns {{brand: string, generation: string, variant: string} | null}
     */
    function versionParts(token) {
      const hit = BRAND_WITH_VERSION.exec(token)
      if (hit === null) return null
      const brand = hit[1]
      return brand.length < 2 ? null : { brand, generation: hit[2], variant: hit[3] }
    }

    /**
     * The brand part of one versioned id token, or '' when the token carries
     * no version tail.
     * @param {string} token - one lowercased id segment.
     * @returns {string} the lowercased brand, or ''.
     */
    function brandOf(token) {
      return versionParts(token)?.brand ?? ''
    }

    /**
     * Resolve one model's family.
     * @param {{id: string, name: string}} model - catalog entry.
     * @returns {string} a flat family name; never empty.
     */
    function familyOf(model) {
      const haystack = `${model.id} ${model.name}`.toLowerCase()
      for (const entry of FAMILY_DICTIONARY) {
        if (entry[1].some(needle => haystack.includes(needle))) return entry[0]
      }
      // Id-derived guess. The provider prefix is dropped, then every remaining
      // segment is checked for a registered brand, so an id that prefixes the
      // brand with its provider (`codebuddy-hy3`) still lands in `HY3`, and a
      // bare brand id (`hy`) resolves to `HY` rather than the generic casing.
      const segments = String(model.id).split(/[/:]/).pop().split(/[-_.]/).filter(Boolean)
      if (segments.length === 0) return OTHERS
      for (const segment of segments) {
        const lower = segment.toLowerCase()
        const parts = versionParts(lower)
        const known = FAMILY_BRANDS.get(lower)
          ?? FAMILY_BRANDS.get(parts?.brand ?? '')
        if (known !== undefined) {
          // A registered brand keeps its generations distinct: hy3 → HY3,
          // hy4free → HY4. A bare brand with no generation stays `HY`.
          return parts === null ? known : `${known}${parts.generation}`
        }
      }
      const token = segments[0].toLowerCase()
      if (token.length < 2 || VERSION_ONLY.test(token)) return OTHERS
      const alias = FAMILY_ALIASES.get(token)
      if (alias !== undefined) return alias
      // An unregistered versioned segment collapses onto its brand, so
      // `acme4-turbo` and `acme-7b` share one heading instead of two.
      const brand = brandOf(token)
      const stem = brand === '' ? token : brand
      return stem.charAt(0).toUpperCase() + stem.slice(1)
    }

    /**
     * Sort rank of a family. Registered-brand generations (`HY3`, `HY4`, …)
     * rank with their bare brand (`HY`) and order by generation number, so a
     * new generation lands next to its siblings instead of at the end.
     */
    function familyRank(family) {
      if (family === OTHERS) return Number.MAX_SAFE_INTEGER
      const known = FAMILY_ORDER.indexOf(family)
      if (known !== -1) return known
      for (const [brand, heading] of FAMILY_BRANDS) {
        if (!family.startsWith(heading) || family.length === heading.length) continue
        const generation = family.slice(heading.length)
        if (!/^\d+$/.test(generation)) continue
        return FAMILY_ORDER.indexOf(heading) + Number(generation) / 1000
      }
      return FAMILY_ORDER.length
    }

    /**
     * A short variant label taken from a model id, used only to tell several
     * models of ONE provider inside ONE family apart. The family prefix is
     * stripped from every id segment, so hy4free → "free", hy4std → "std",
     * hy4-preview → "preview", hy4flash-exp1 → "flash exp1", hy3-x → "x",
     * and a bare hy3 → "". Pure version numbers are dropped. Returns '' when
     * the id carries nothing beyond the family heading itself.
     * @param {{id: string}} model - catalog entry.
     * @param {string} family - the resolved family heading.
     * @returns {string} a short variant label, or ''.
     */
    function idVariantOf(model, family) {
      const familyLower = family.toLowerCase()
      const segments = String(model.id).split(/[/:]/).pop().split(/[-_.]/).filter(Boolean)
      const words = []
      for (const raw of segments) {
        const segment = raw.toLowerCase()
        // Remove the family heading from inside a glued segment: hy4free →
        // free, hy4flash → flash. A segment equal to the family drops to ''.
        let word = segment.startsWith(familyLower) ? segment.slice(familyLower.length) : segment
        word = word.replace(/^[-._]+/, '')
        if (word === '' || /^\d+(\.\d+)?$/.test(word)) continue
        words.push(...word.split(/[-._]+/).filter(Boolean))
      }
      return words.filter(word => !/^\d+$/.test(word)).join(' ')
    }

    /**
     * Separators a strip leaves dangling at either end of a tail. `·` is the
     * catalog's own "name · multiplier" separator (`Hy4 · x0.00`).
     */
    const TAIL_EDGE = /^[\s·・.,:;|/\\_-]+|[\s·・.,:;|/\\_-]+$/g

    /**
     * Remove every occurrence of a family heading from a text, as a SUBSTRING.
     *
     * A family is glued to its version tail in real ids and names — `Qwen3.8-…`,
     * `Deepseek-V4.1-…`, `MiniMax-M3` — so a whole-word match would miss the
     * very case this exists for. The gap left behind becomes a space, so
     * removing a prefix never glues two words together.
     * @param {string} text - the model name.
     * @param {string} needle - the family heading.
     * @returns {string} the text with the heading removed.
     */
    function dropSubstring(text, needle) {
      const lower = needle.toLowerCase()
      if (lower.length < 2) return text
      let out = text
      for (;;) {
        const at = out.toLowerCase().indexOf(lower)
        if (at === -1) return out
        out = `${out.slice(0, at)} ${out.slice(at + lower.length)}`
      }
    }

    /**
     * Remove whole words from a text (case-insensitive).
     *
     * Used for the provider's own label, which is the row's PRIMARY text — so a
     * tail that repeats it would print the same word twice. Whole-word matching
     * is what keeps a short token from punching a hole in an unrelated word
     * (provider `AI` must not turn `Rain` into `Rn`). Word edges are any
     * non-letter/digit, so the CJK provider label `豆包` still matches inside
     * `豆包 2.1 Turbo`.
     * @param {string} text - the model name.
     * @param {string[]} words - provider label words; each needs 2+ characters.
     * @returns {string} the text with those words removed.
     */
    function dropWords(text, words) {
      let out = text
      for (const word of words) {
        if (word.length < 2) continue
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        out = out.replace(
          new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'),
          ' ',
        )
      }
      return out
    }

    /**
     * The model-specific part of a family-grouped row: the model name with the
     * family heading and the provider's own label removed, so only what the
     * heading does NOT already say is left.
     *
     * `Qwen3.8-Flash-Next` under `Qwen` → `3.8-Flash-Next`, `Qwen3.8-27B` →
     * `3.8-27B`; `Deepseek-V4.1-Flash · x0.00` under `DeepSeek` →
     * `V4.1-Flash · x0.00`; `豆包 2.1 Turbo` under provider `豆包(doubao)` →
     * `2.1 Turbo`. Version numbers are KEPT — they are the型号 the heading
     * lacks, unlike the id-derived tail that drops them.
     *
     * When the name adds nothing (`Hy4` under `HY4`), the id tail is used so a
     * variant like `hy4free` still reads `free`. An empty result is valid: the
     * row then draws no tail at all.
     * @param {{id: string, name: string}} model - catalog entry.
     * @param {string} family - the resolved family heading.
     * @param {string} [providerLabel] - the row's primary text; stripped when it repeats.
     * @returns {string} the model-specific supplement; possibly ''.
     */
    function rowVariantOf(model, family, providerLabel = '') {
      const name = String(model.name ?? '')
      const providerWords = String(providerLabel).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      const tail = dropWords(dropSubstring(name, family), providerWords)
        .replace(/\s+/g, ' ')
        .replace(TAIL_EDGE, '')
      if (tail !== '') return tail
      return idVariantOf(model, family)
    }

    // ---------------------------------------------------------------------
    // Column planning
    // ---------------------------------------------------------------------
    /** One indivisible placement unit: a group title with its first model, or a lone model row. */
    function buildUnits(sections, rowH, headH) {
      const units = []
      for (const section of sections) {
        if (section.models.length === 0) continue
        units.push({
          height: headH + ROW_GAP + rowH,
          blocks: [
            { kind: 'title', key: `t:${section.key}`, label: section.title },
            { kind: 'row', key: `r:${section.key}:0`, entry: section.models[0] },
          ],
        })
        for (let index = 1; index < section.models.length; index += 1) {
          units.push({
            height: rowH,
            blocks: [{ kind: 'row', key: `r:${section.key}:${index}`, entry: section.models[index] }],
          })
        }
      }
      return units
    }

    function columnHeight(units) {
      if (units.length === 0) return 0
      return units.reduce((sum, unit) => sum + unit.height, 0) + ROW_GAP * (units.length - 1)
    }

    /**
     * Flow units into `count` columns, then migrate the last column's deficit
     * back into its neighbour. A group title never separates from its first
     * model because both live in one unit.
     */
    function packColumns(units, count) {
      const columns = Array.from({ length: count }, () => [])
      const target = columnHeight(units) / count
      let index = 0
      for (let column = 0; column < count && index < units.length; column += 1) {
        const isLast = column === count - 1
        let used = 0
        while (index < units.length) {
          const unit = units[index]
          const add = used === 0 ? unit.height : unit.height + ROW_GAP
          if (!isLast && used > 0 && used + add > target) break
          columns[column].push(unit)
          used += add
          index += 1
        }
      }
      while (index < units.length) {
        columns[count - 1].push(units[index])
        index += 1
      }
      // Balance the final pair only when it actually narrows the spread.
      if (count > 1) {
        for (let guard = 0; guard < units.length; guard += 1) {
          const left = columns[count - 2]
          const right = columns[count - 1]
          if (left.length <= 1) break
          const leftHeight = columnHeight(left)
          const rightHeight = columnHeight(right)
          if (leftHeight - rightHeight < BALANCE_THRESHOLD) break
          const unit = left[left.length - 1]
          const before = Math.max(leftHeight, rightHeight)
          const after = Math.max(columnHeight(left.slice(0, -1)), columnHeight([...right, unit]))
          if (after >= before) break
          left.pop()
          right.push(unit)
        }
      }
      return columns
    }

    /** Smallest column count (1–3) whose tallest column fits; otherwise 3 + scroll. */
    function planColumns(units, available) {
      if (units.length === 0) return { count: 1, columns: [[]] }
      for (let count = 1; count <= 3; count += 1) {
        const columns = packColumns(units, count)
        if (Math.max(...columns.map(columnHeight)) <= available) return { count, columns }
      }
      return { count: 3, columns: packColumns(units, 3) }
    }

    // ---------------------------------------------------------------------
    // Dictionaries (this namespace owns the panel's own copy; the teamwork
    // row prefers the host's `agent-team` wording when it is registered).
    //
    // The namespace id is minted per module generation. The locale registry
    // keeps a namespace's slot after its disposer runs, and a re-registration
    // of the same id throws — which would cost the seat its copy on the
    // enable/disable/enable path. A fresh id makes every generation's
    // registration independent, and the previous one is dropped with its own
    // disposer.
    // ---------------------------------------------------------------------
    const NS = `modelFlatmap-${Math.random().toString(36).slice(2, 10)}`

    // ---------------------------------------------------------------------
    // Grouping persistence — across sessions and workgroups.
    //
    // The `按 Provider / 按模型家族` choice is a user preference that must
    // survive a reload, a new conversation, and a workgroup switch. On DSH
    // Desktop the Web GUI runs on a stable origin (a fixed bundled origin in
    // production, `http://127.0.0.1:56668` in development), so `localStorage`
    // — origin-scoped, not session-scoped — is exactly the right store: it
    // persists across every one of those boundaries. DSH's own client store
    // (`@deepseek-ai/dsh-client-store`) is the same `localStorage` wrapper
    // under the hood, but importing an internal Harness client package is
    // forbidden by the UI rules (it changes without notice and a throw blanks
    // the seat). We therefore use `localStorage` directly — the public,
    // self-contained mechanism the host endorses underneath.
    //
    // The store is read and written lazily, and every access degrades: when
    // `localStorage` is unavailable (private mode, sandboxed frame) the choice
    // still works for the lifetime of the tab, falling back to the in-memory
    // default rather than throwing.
    // ---------------------------------------------------------------------
    const GROUPING_KEY = 'dshmf:grouping'
    const GROUPING_DEFAULT = 'provider'
    /**
     * Read the persisted grouping, or the default when nothing valid was stored.
     * @returns `'provider'` or `'family'`.
     */
    function readGrouping() {
      try {
        if (typeof localStorage === 'undefined') return GROUPING_DEFAULT
        const value = localStorage.getItem(GROUPING_KEY)
        return value === 'provider' || value === 'family' ? value : GROUPING_DEFAULT
      } catch {
        return GROUPING_DEFAULT
      }
    }
    /**
     * Persist one grouping choice. A write failure (quota, disabled storage)
     * is swallowed: the in-memory state still drives the current tab.
     * @param {'provider'|'family'} value - the choice to persist.
     */
    function writeGrouping(value) {
      try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(GROUPING_KEY, value)
      } catch {
        /* storage unavailable — keep the in-memory choice only */
      }
    }

    // ---------------------------------------------------------------------
    // Display mode — `flat` (this panel) or `native` (the Host's own picker).
    //
    // The panel can hand the composer's model seat back to whatever the Host
    // ships in `conversation.input.model`. It does that by DISPOSING its own
    // slot entry. A `single` slot keeps EVERY registration and renders only the
    // highest-priority live one, so the shipped entry underneath is elected and
    // the real, current Host component appears. Nothing is copied, imported or
    // re-mounted — which is the whole point: an upgraded DSH shows its own
    // newest picker, so this mode cannot drift out of date (DEC-027).
    //
    // The choice persists exactly like the grouping choice (origin-scoped
    // `localStorage`), and every access degrades to `flat` — a missing store
    // must never be able to leave the composer without a model control.
    // ---------------------------------------------------------------------
    const DISPLAY_MODE_KEY = 'dshmf:mode'
    const DISPLAY_MODE_DEFAULT = 'flat'
    /**
     * Read the persisted display mode, or the default when nothing valid was
     * stored (or storage is unavailable).
     * @returns `'flat'` or `'native'`.
     */
    function readDisplayMode() {
      try {
        if (typeof localStorage === 'undefined') return DISPLAY_MODE_DEFAULT
        const value = localStorage.getItem(DISPLAY_MODE_KEY)
        return value === 'flat' || value === 'native' ? value : DISPLAY_MODE_DEFAULT
      } catch {
        return DISPLAY_MODE_DEFAULT
      }
    }
    /**
     * Persist one display mode. A write failure is swallowed: the in-memory
     * value still drives the current tab.
     * @param {'flat'|'native'} value - the mode to persist.
     */
    function writeDisplayMode(value) {
      try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(DISPLAY_MODE_KEY, value)
      } catch {
        /* storage unavailable — keep the in-memory choice only */
      }
    }
    /** Schedule a callback outside the current event dispatch. */
    const scheduleMicrotask = typeof queueMicrotask === 'function'
      ? queueMicrotask
      : callback => { Promise.resolve().then(callback) }

    /**
     * The ONE display-mode store per plugin generation: a uSES-safe snapshot
     * (`getSnapshot` keeps referential identity until the value changes) shared
     * by the panel's mode button and the composer-row chip.
     *
     * `set` notifies `queueMicrotask`-late on purpose. The click that switches
     * the mode DISPOSES the slot entry that owns the button, so notifying
     * synchronously would mutate the slot registry in the middle of React's
     * event dispatch — the entry would vanish while its own handler is still on
     * the stack.
     * @param deps - storage accessors, injected for testability.
     * @returns the store plus an idempotent `set`.
     */
    function createDisplayModeStore(deps) {
      const normalize = value => (value === 'native' ? 'native' : DISPLAY_MODE_DEFAULT)
      let value = normalize(typeof deps.readStored === 'function' ? deps.readStored() : DISPLAY_MODE_DEFAULT)
      const listeners = new Set()
      let scheduled = false
      const flush = () => {
        scheduled = false
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch {
            /* one bad subscriber must not starve the others */
          }
        }
      }
      return {
        getSnapshot: () => value,
        subscribe: listener => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set: next => {
          const normalized = normalize(next)
          if (normalized === value) return
          value = normalized
          try {
            if (typeof deps.writeStored === 'function') deps.writeStored(value)
          } catch {
            /* storage unavailable — the in-memory value still applies */
          }
          if (scheduled) return
          scheduled = true
          scheduleMicrotask(flush)
        },
        /** Drop every subscriber (activation teardown). */
        dispose: () => {
          listeners.clear()
          scheduled = false
        },
      }
    }
    /**
     * Frozen stand-in for a screen that has no store (a degraded activation, or
     * a test double). One shared instance keeps `getSnapshot` stable, so a uSES
     * consumer never re-renders in a loop.
     */
    const FLAT_DISPLAY_MODE = {
      getSnapshot: () => DISPLAY_MODE_DEFAULT,
      subscribe: () => () => {},
      set: () => {},
    }

    // ---------------------------------------------------------------------
    // Insufficient-balance marks are GLOBAL, not Session-scoped.
    //
    // Whether a model has any quota left is a fact about the model route (and
    // the account behind it), not about one conversation: a failure observed in
    // one Session must strike the same model everywhere — another Session,
    // another workspace, and after a reload. So the marks live in ONE
    // module-level store shared by every seat of this plugin generation, and
    // are persisted to `localStorage` (origin-scoped, exactly like the grouping
    // choice) so a fresh page load starts from the last known state.
    //
    // Ordering across Sessions is by wall-clock time: each durable event keeps
    // the Host's `time`, and the newest observation of a route wins. That is
    // what lets a replayed window (or a stored entry) never override a newer
    // fact from another Session.
    //
    // The same stamp is what makes a strike go STALE: it is the time the verdict
    // was made, so a mark nobody refreshed stops being drawn after STRIKE_TTL
    // while the record stays behind as the watermark. See markIsLive.
    // ---------------------------------------------------------------------
    const MARKS_KEY = 'dshmf:insufficient'
    /**
     * How long a RECORD is kept. Records older than this are dropped on read,
     * so a stale verdict cannot live forever — and so a cleared route's
     * watermark (which shields it from a replayed older failure) has an end.
     */
    const MARKS_TTL = 7 * 24 * 60 * 60 * 1000
    /**
     * How long a MARK is DRAWN. This is the one the user sees: if nothing new has
     * been observed for a route for a day, the user never retried it, and the
     * panel stops claiming the model is unusable — an exhausted balance gets
     * topped up and a quota resets daily, so a strike that outlives a whole day
     * of silence is stale information, not a warning. The record itself survives
     * (up to {@link MARKS_TTL}) as the watermark that keeps a replayed older
     * failure from re-stamping it.
     */
    const STRIKE_TTL = 24 * 60 * 60 * 1000

    /**
     * Whether one record still justifies drawing a strike at `now`.
     *
     * `at` is the time of the LAST observation for the route, so the answer to
     * "has the user tried this model again?" is already in it: a retry that
     * failed on balance restamps `at` and restarts the window, a retry that
     * answered flips `marked`, and a route nobody touched just ages out.
     * @param {{ marked: boolean, at: number } | undefined} entry - one record.
     * @param {number} now - the current wall-clock time.
     * @param {number} [strikeTtl] - how long a mark is drawn; defaults to {@link STRIKE_TTL}.
     * @returns {boolean} true only for a mark that is set AND still fresh.
     */
    function markIsLive(entry, now, strikeTtl) {
      if (entry === undefined || entry.marked !== true) return false
      const life = typeof strikeTtl === 'number' && Number.isFinite(strikeTtl) ? strikeTtl : STRIKE_TTL
      // A stamp from the future (a clock that ran ahead) is fresh, never expired.
      return now - entry.at < life
    }

    /**
     * Parse a persisted mark record into the in-memory shape, dropping anything
     * malformed or older than {@link MARKS_TTL}. Pure, so the storage format is
     * testable without a `localStorage` shim.
     * @param {unknown} raw - the stored JSON value (already parsed).
     * @param {number} now - current time, injected for testability.
     * @returns {Map<string, {marked: boolean, at: number}>} the parsed entries.
     */
    function parseMarks(raw, now) {
      const entries = new Map()
      if (raw === null || typeof raw !== 'object') return entries
      for (const [key, value] of Object.entries(raw)) {
        if (typeof key !== 'string' || key === '') continue
        if (value === null || typeof value !== 'object') continue
        const at = typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : 0
        if (typeof value.marked !== 'boolean') continue
        if (now - at > MARKS_TTL) continue
        entries.set(key, { marked: value.marked, at })
      }
      return entries
    }

    /**
     * Serialise the in-memory entries for storage, dropping anything older than
     * {@link MARKS_TTL} so a long-lived page cannot grow the record forever. A
     * cleared route keeps its watermark only while it can still protect against
     * a replayed older failure, which is the same window.
     * @param {Map<string, {marked: boolean, at: number}>} entries - the state.
     * @param {number} [now] - current time, injected for testability.
     * @returns {Record<string, {marked: boolean, at: number}>} a JSON-ready record.
     */
    function serializeMarks(entries, now) {
      const time = now === undefined ? Date.now() : now
      const out = {}
      for (const [key, value] of entries) {
        if (time - value.at > MARKS_TTL) continue
        out[key] = { marked: value.marked, at: value.at }
      }
      return out
    }

    /**
     * Read the persisted marks, or an empty map when storage is unavailable,
     * holds garbage, or throws (private mode, sandboxed frame, quota).
     * @returns {Map<string, {marked: boolean, at: number}>} the stored entries.
     */
    function readMarks() {
      try {
        if (typeof localStorage === 'undefined') return new Map()
        const text = localStorage.getItem(MARKS_KEY)
        if (text === null || text === '') return new Map()
        return parseMarks(JSON.parse(text), Date.now())
      } catch {
        return new Map()
      }
    }

    /**
     * Persist the marks. A write failure is swallowed: the in-memory store still
     * drives every open panel in this page.
     * @param {Map<string, {marked: boolean, at: number}>} entries - the state.
     */
    function writeMarks(entries) {
      try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(MARKS_KEY, JSON.stringify(serializeMarks(entries)))
      } catch {
        /* storage unavailable — keep the in-memory state only */
      }
    }

    /**
     * Whether two visible mark maps hold the same entries.
     *
     * Iterating a Map yields `[key, value]` PAIRS, so this walks `keys()` — a
     * `for (const key of map)` here compares a pair against `has()` and always
     * answers "different", which hands the seats a brand-new snapshot object on
     * every recompute and puts `useSyncExternalStore` into a render loop.
     */
    function sameMarks(left, right) {
      if (left.size !== right.size) return false
      for (const key of left.keys()) {
        if (!right.has(key)) return false
      }
      return true
    }

    /**
     * Create the one global mark store for this module generation.
     *
     * It owns the state, the listeners, and the Session-feed subscriptions; the
     * seats only read it. Observing EVERY Session (not just the one a seat
     * renders for) is what makes a failure recorded anywhere visible
     * everywhere, including in a Session whose own feed was never opened in this
     * page load (its marks come from storage).
     *
     * The store is also the thing that ages strikes out. A mark retiring itself
     * is a state change no event announces, so the store watches the clock on its
     * own behalf — on every fold, on every seat mounting, and on a timer set for
     * the soonest deadline — instead of waiting for a fold that may never come.
     *
     * @param {object} deps - resolution hooks.
     * @param {() => object | undefined} deps.sessionsOf - read the `sessions` service, per call.
     * @param {() => Map<string, {marked: boolean, at: number}>} deps.readStored - initial/persisted state.
     * @param {(entries: Map<string, {marked: boolean, at: number}>) => void} deps.writeStored - persistence sink.
     * @param {() => number} [deps.now] - the clock; defaults to `Date.now`.
     * @param {number} [deps.strikeTtl] - strike lifetime; defaults to {@link STRIKE_TTL}.
     * @returns {object} the store: `subscribe`, `getSnapshot`, `dispose`, `sync`, `watch`, `refresh`.
     */
    function createMarkStore(deps) {
      /**
       * The clock strikes age against. Injectable so a test does not have to sit
       * through a day; every read of the state takes it fresh, because a page
       * lives long enough for the wall clock to matter.
       */
      const nowFn = typeof deps.now === 'function' ? deps.now : () => Date.now()
      const strikeTtl = typeof deps.strikeTtl === 'number' && Number.isFinite(deps.strikeTtl)
        ? deps.strikeTtl
        : STRIKE_TTL
      /** Internal truth: route key → last decision and when it was made. */
      const entries = new Map(deps.readStored())
      /** Visible subset the rows read: route key → true, the LIVE marks only. */
      let visible = new Map()
      let snapshot = { marks: visible }
      const listeners = new Set()
      /** Per-Session route of the latest request header (a route is Session-local). */
      const routes = new Map()
      /**
       * Per-Session event feed subscription: `{ source, stop }`. The source is
       * kept beside its unsubscribe so a re-materialised Session (same id, new
       * `eventSource`) is detected and re-attached instead of silently staying
       * bound to the retired feed.
       */
      const stops = new Map()
      /** Sessions attached on behalf of a mounted seat; never pruned by a list sync. */
      const pinned = new Set()
      /** Last `sessions` service seen, so a reloaded service is re-attached. */
      let attachedSessions
      let stopList
      let disposed = false
      /** Timer for the soonest strike that is still being drawn. */
      let expiryTimer = null

      const publish = () => {
        for (const listener of listeners) listener()
      }

      /** Rebuild the visible map against the clock; report whether it changed. */
      const recompute = () => {
        const now = nowFn()
        const next = new Map()
        for (const [key, entry] of entries) {
          if (markIsLive(entry, now, strikeTtl)) next.set(key, true)
        }
        if (sameMarks(visible, next)) return false
        visible = next
        snapshot = { marks: visible }
        return true
      }

      /**
       * Arm the clock for the soonest live strike.
       *
       * A strike retiring is the one transition no event reports: the user
       * simply never came back to this model. A page left open across the
       * deadline therefore has to wake itself, or a stale line-through would sit
       * on the row until some unrelated fold happened to recompute it.
       */
      const scheduleExpiry = () => {
        if (expiryTimer !== null) {
          clearTimeout(expiryTimer)
          expiryTimer = null
        }
        if (disposed || typeof setTimeout !== 'function') return
        const now = nowFn()
        let earliest = Number.POSITIVE_INFINITY
        for (const entry of entries.values()) {
          if (!markIsLive(entry, now, strikeTtl)) continue
          const deadline = entry.at + strikeTtl
          if (deadline < earliest) earliest = deadline
        }
        if (!Number.isFinite(earliest)) return
        const handle = setTimeout(() => {
          expiryTimer = null
          refresh()
        }, Math.max(0, earliest - now))
        // A day-long timer must never be the reason a process stays alive (a
        // Node host, a test run): `unref` lets it fire while anything else is
        // running without holding the loop. A browser handle is a number and has
        // no `unref`, and there the page keeps its own clock.
        if (typeof handle?.unref === 'function') handle.unref()
        expiryTimer = handle
      }

      /**
       * Re-read the clock and tell the seats if anything aged out.
       * @returns {boolean} whether the rendered set changed.
       */
      const refresh = () => {
        if (disposed) return false
        const changed = recompute()
        // Re-arm first: a strike that just aged out may leave a later one live.
        scheduleExpiry()
        if (changed) publish()
        return changed
      }

      recompute()
      scheduleExpiry()

      /** Fold one batch of durable entries for one Session. */
      const absorb = (sessionId, windowEntries) => {
        let stored = false
        let changed = false
        for (const entry of windowEntries) {
          const event = entry?.event
          if (event === null || event === undefined) continue
          const header = routeOfHeader(event)
          if (header !== null) {
            routes.set(sessionId, header)
            continue
          }
          if (event.type !== 'turn/end') continue
          const route = routes.get(sessionId) ?? null
          const marked = decideMark(event, route)
          if (marked === null) continue
          const result = foldMarkEntry(
            entries, routeKeyOf(route.provider, route.model), marked, eventTimeOf(event),
          )
          if (result.stored) stored = true
          if (result.visible) changed = true
        }
        return { stored, changed }
      }

      /** Read a window's entries defensively. */
      const entriesOf = window => (Array.isArray(window?.entries) ? window.entries : [])

      /** Apply one feed window for one Session. */
      const applyWindow = (sessionId, window, full) => {
        const change = window?.change
        let result
        if (full || change?.kind === 'replace' || change?.kind === 'prepend') {
          // `replace` is that Session's whole truth, so its route restarts and
          // its entries are re-walked. Global watermarks keep a newer fact from
          // another Session from being overwritten by this replay.
          //
          // `prepend` (scrolling up) must be re-walked for the SAME reason, and
          // this is not an optimisation to skip: older history is exactly where
          // a failure lives once the turn that hit it has scrolled out of the
          // first page. Folding only the appended tail left the store blind to
          // every failure that happened before the window's oldest entry, which
          // is the common case on a long Session — the strike then never
          // appeared for the model that actually ran out. The route map is
          // Session-local and positional, so the prepended page is folded with
          // the whole window (oldest entry first) to attribute each failure to
          // the header that really preceded it.
          routes.delete(sessionId)
          result = absorb(sessionId, entriesOf(window))
        } else if (change?.kind === 'append') {
          result = absorb(sessionId, change.entries)
        } else {
          // `settle-assistant` only swaps a live attempt for its durable form —
          // an Assistant message — so it cannot carry a turn/end or a header.
          return
        }
        if (result.stored) deps.writeStored(entries)
        // The clock — not the raw record — decides what the rows draw, and a new
        // record moves the soonest deadline, so re-read both after any fold.
        if (result.stored || result.changed) refresh()
      }

      /**
       * Attach to one Session's durable feed. Idempotent for one feed, and a
       * no-op when the Session has no retained binding (an unopened Session has
       * no feed; its marks can only come from storage).
       *
       * "Already attached" has to mean "attached to THIS feed", not "attached to
       * this Session id". The Client materialises a Session scope on demand and
       * retires it when nothing retains it any more — switching to another
       * conversation and coming back, or opening a second one, drops the old
       * scope and builds a NEW Session object with a NEW `eventSource`. Keying
       * the subscription by id alone left the store listening to the retired
       * feed forever: the live failure was never folded (no strike appeared)
       * while the dead feed could still inject stale facts. So the subscription
       * is remembered together with the source it came from and replaced when
       * the identity changes.
       */
      const attachSession = sessionId => {
        if (disposed) return
        const sessions = deps.sessionsOf()
        let binding
        try {
          binding = typeof sessions?.binding === 'function' ? sessions.binding(sessionId) : undefined
        } catch {
          binding = undefined
        }
        const source = binding?.eventSource
        if (source === undefined || typeof source.subscribe !== 'function'
          || typeof source.getSnapshot !== 'function') return
        const attached = stops.get(sessionId)
        if (attached !== undefined && attached.source === source) return
        // A different feed for the same id: drop the dead subscription and
        // forget the route map, which was derived from the retired window.
        if (attached !== undefined) {
          try {
            attached.stop()
          } catch {
            /* a refused unsubscribe must not keep the new feed out */
          }
          stops.delete(sessionId)
          routes.delete(sessionId)
        }
        try {
          applyWindow(sessionId, source.getSnapshot(), true)
        } catch {
          /* an unreadable feed leaves the store as it was */
        }
        const listener = () => {
          try {
            applyWindow(sessionId, source.getSnapshot(), false)
          } catch {
            /* a fold failure must not escape into the slot */
          }
        }
        try {
          const stop = source.subscribe(listener)
          stops.set(sessionId, {
            source,
            stop: typeof stop === 'function' ? stop : () => {},
          })
        } catch {
          /* subscription refused: leave this Session unattached */
        }
      }

      /** Attach to every Session the list currently names, and drop the rest. */
      const sync = () => {
        if (disposed) return
        const sessions = deps.sessionsOf()
        if (sessions === undefined) return
        // A client reload replaces the service; re-attach from the new one.
        if (sessions !== attachedSessions) {
          for (const attached of stops.values()) attached.stop()
          stops.clear()
          routes.clear()
          if (typeof stopList === 'function') stopList()
          stopList = undefined
          attachedSessions = sessions
          try {
            if (sessions.list !== undefined && typeof sessions.list.subscribe === 'function') {
              stopList = sessions.list.subscribe(() => { sync() })
            }
          } catch {
            stopList = undefined
          }
        }
        let ids = []
        try {
          const list = sessions.list?.getSnapshot?.()
          ids = Array.isArray(list?.ids) ? list.ids : []
        } catch {
          ids = []
        }
        for (const id of ids) attachSession(id)
        // Drop feeds for Sessions the list no longer names, unless a mounted
        // seat is currently reading that Session (it may not be listed yet).
        for (const id of [...stops.keys()]) {
          if (pinned.has(id)) continue
          if (!ids.includes(id)) {
            stops.get(id)?.stop()
            stops.delete(id)
            routes.delete(id)
          }
        }
      }

      return {
        /** The seat's `useSyncExternalStore` pair. */
        subscribe: listener => {
          // A seat mounting IS the model list being displayed, so this is where a
          // strike that aged out while nobody was looking gets retired — before
          // React reads the snapshot it is about to render from.
          refresh()
          listeners.add(listener)
          sync()
          return () => { listeners.delete(listener) }
        },
        getSnapshot: () => snapshot,
        /** Re-attach (services may bind after the plugin activated). */
        sync,
        /**
         * Pin and immediately attach one Session's feed, for a mounted seat.
         * The list may not name this Session yet (or at all), so it is attached
         * directly instead of waiting for a list sync.
         */
        watch: sessionId => {
          if (disposed) return
          pinned.add(sessionId)
          sync()
          attachSession(sessionId)
          refresh()
        },
        /**
         * Re-read the clock: retire any mark older than the strike lifetime and
         * notify the seats that drew it. Call it whenever the list is displayed,
         * because that is the moment the answer must be current.
         */
        refresh,
        /** Release every feed subscription. The marks themselves stay persisted. */
        dispose: () => {
          if (disposed) return
          disposed = true
          if (expiryTimer !== null) {
            clearTimeout(expiryTimer)
            expiryTimer = null
          }
          for (const attached of stops.values()) attached.stop()
          stops.clear()
          routes.clear()
          pinned.clear()
          if (typeof stopList === 'function') stopList()
          stopList = undefined
          listeners.clear()
        },
      }
    }

    const dict = {
      zh: {
        'provider.account': 'DeepSeek 账号',
        'search.placeholder': '搜索模型…',
        'search.clear': '清除搜索',
        'group.provider': '按 Provider',
        'group.family': '按模型家族',
        'group.aria': '模型分组方式',
        'empty.models': '暂无可用模型',
        'empty.search': '无匹配模型',
        'status.loading': '正在刷新模型列表…',
        'trigger.fallback': '请选择模型',
        'trigger.loading': '正在加载模型…',
        'trigger.aria': '选择模型，当前 {model}',
        'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
        'panel.aria': '模型与推理等级',
        'effort.default': 'Default',
        'effort.label': '推理等级',
        'effort.hint': '调整模型的思考强度：档位越高，思考越深入，但速度更慢、token 开销更大。',
        'team.label': '启用智能体团队协作',
        'team.description': '通过共享任务板协调多个智能体的分工与进度，复杂任务表现更佳，token 开销也相应更高。',
        'team.failed': '无法确认智能体团队协作设置已保存，请重试：{message}',
        'team.disable.title': '确认停用智能体团队协作？',
        'team.disable.description': '对话过程中停用智能体团队协作，将停止共享任务工具和团队协调指令。',
        'team.disable.warning': '停用后可能影响缓存复用、增加后续 token 用量与开销，并影响当前任务的协作效果。',
        'team.disable.cancel': '取消',
        'team.disable.confirm': '确认停用',
        'failure.group': '{name} 加载失败：{message}',
        'error.action': '模型操作失败：{message}',
        'error.sessionInUse': '当前会话已被占用，可能是其他正在运行的 DSH 导致的，请退出其他正在运行的 DSH 后重试。',
        'native.label': '默认样式',
        'native.enter': '切换到默认样式',
        'native.back': '回到平铺模型面板',
        'native.unavailable': '默认样式当前不可用',
      },
      en: {
        'provider.account': 'DeepSeek Account',
        'search.placeholder': 'Search models…',
        'search.clear': 'Clear search',
        'group.provider': 'By provider',
        'group.family': 'By family',
        'group.aria': 'Group models by',
        'empty.models': 'No models available',
        'empty.search': 'No matching models',
        'status.loading': 'Refreshing model list…',
        'trigger.fallback': 'Select model',
        'trigger.loading': 'Loading models…',
        'trigger.aria': 'Select model, current {model}',
        'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
        'panel.aria': 'Model and reasoning effort',
        'effort.default': 'Default',
        'effort.label': 'Reasoning effort',
        'effort.hint': 'Adjusts how deeply the model thinks: higher levels reason more deeply, but are slower and cost more tokens.',
        'team.label': 'Enable agent teamwork',
        'team.description': 'Coordinate work and progress across agents with a shared task board for better results on complex tasks, with correspondingly higher token costs.',
        'team.failed': 'Could not confirm the agent teamwork setting was saved. Try again: {message}',
        'team.disable.title': 'Disable agent teamwork?',
        'team.disable.description': 'Disabling agent teamwork during a conversation stops the use of shared task tools and team coordination instructions.',
        'team.disable.warning': 'Disabling it may affect cache reuse, increase subsequent token usage and costs, and affect collaboration on the current task.',
        'team.disable.cancel': 'Cancel',
        'team.disable.confirm': 'Disable',
        'failure.group': '{name} failed to load: {message}',
        'error.action': 'Model operation failed: {message}',
        'error.sessionInUse': 'This session is already in use, possibly by another running DSH instance. Quit other running DSH instances and try again.',
        'native.label': 'Default style',
        'native.enter': 'Switch to the default style',
        'native.back': 'Back to the flat model panel',
        'native.unavailable': 'The default style is unavailable right now',
      },
    }

    const EMPTY_STATE = {
      current: null,
      retainedEffort: undefined,
      routable: null,
      groups: [],
      failures: [],
      status: 'idle',
      pending: null,
      error: null,
    }

    /**
     * Stand-in store used before a Session's directory resolves. It never
     * notifies, so `useSyncExternalStore` keeps a constant hook shape while the
     * real store is swapped in — the component therefore always renders a
     * trigger, never `null`.
     */
    const EMPTY_STORE = {
      subscribe: () => () => {},
      getSnapshot: () => EMPTY_STATE,
    }

    /**
     * Shared empty mark map. One frozen instance keeps `getSnapshot` referentially
     * stable for every seat that has no store, so an unmarked panel never
     * re-renders because of this feature.
     */
    const EMPTY_INSUFFICIENT_MARKS = new Map()

    /**
     * The one empty snapshot object. It MUST be a single shared instance:
     * `useSyncExternalStore` compares snapshots by identity, so returning a
     * fresh `{ marks }` on every call would look like a change on every render
     * and loop.
     */
    const EMPTY_INSUFFICIENT_SNAPSHOT = { marks: EMPTY_INSUFFICIENT_MARKS }

    /**
     * Stand-in mark face used when the store degraded. It never notifies and
     * always answers the same empty snapshot.
     */
    const EMPTY_INSUFFICIENT = {
      subscribe: () => () => {},
      getSnapshot: () => EMPTY_INSUFFICIENT_SNAPSHOT,
      watch: () => {},
      refresh: () => {},
    }

    /**
     * The slot whose occupant decorates a model name in the shipped picker.
     *
     * It is a `single`, session-scoped child slot declared by the shipped
     * `ModelSelect` entry. This plugin shadows that entry but never disposes it,
     * so the declaration and every contribution to it stay alive — which is
     * exactly why the trigger can draw the same occupant the native picker
     * would (DEC-030).
     */
    const LABEL_SLOT = 'conversation.input.model.label'

    /**
     * Read the entry that currently OWNS the label cell, or undefined.
     *
     * `entriesOfSlot` is the documented "winner per cell" accessor (the same
     * one the renderer's outlet uses), so this asks the host the same question
     * the native trigger does rather than guessing at priorities. Anything
     * unexpected — an older host without the accessor, a thrown service call, a
     * slot that lost its declaration — answers undefined and the trigger falls
     * back to the catalog name, which is the shipped fallback's own behaviour.
     * @param {object|undefined} slots - the `slots` client service.
     * @returns {object|undefined} the winning StoredEntry.
     */
    function readLabelEntry(slots) {
      if (slots === undefined || slots === null || typeof slots.entriesOfSlot !== 'function') return undefined
      try {
        const winners = slots.entriesOfSlot(LABEL_SLOT)
        const entry = Array.isArray(winners) ? winners[0] : undefined
        // A component is the whole point; an entry without one (or a cell that
        // abdicated after a crash) is the same as no occupant at all.
        return entry !== undefined && typeof entry.component === 'function' ? entry : undefined
      } catch {
        return undefined
      }
    }

    /** One shared passthrough, so a degraded seat is not a new reference per render. */
    const identityTranslate = key => String(key)

    /** Shared empty business face, for the same reason as `identityTranslate`. */
    const EMPTY_LABEL_FACE = {}

    /** Per (locale face, namespace, revision) translate seats, mirroring the renderer. */
    const labelSeatCache = new WeakMap()

    /**
     * Build the locale seat a label occupant expects.
     *
     * A registered entry's `t` is synthesized by the renderer from its declared
     * `locale` namespace (`entry.locale`) through the installed locale face's
     * `bind()`. Rendering that component ourselves means synthesizing the same
     * seat; a contribution that declares no namespace gets a passthrough that
     * answers its own key, which is what the renderer's kit would omit anyway.
     * @param {object|undefined} locale - the `locale` client service.
     * @param {string|undefined} namespace - the occupant's declared namespace.
     * @returns {Function} a translate seat.
     */
    function labelSeat(locale, namespace) {
      if (typeof namespace !== 'string' || namespace === '') return identityTranslate
      if (locale === undefined || typeof locale.bind !== 'function') return identityTranslate
      try {
        // Cached per (face, namespace, revision) exactly as the renderer's own
        // `localeSeat` does. The identity matters: the occupant is a React
        // component, and a fresh `t` on every render would look like new props
        // on every paint — a memoized chip would re-render forever, and an
        // effect keyed on `t` would re-run forever.
        const revision = typeof locale.getSnapshot === 'function'
          ? locale.getSnapshot()?.revision
          : undefined
        let perNamespace = labelSeatCache.get(locale)
        if (perNamespace === undefined) {
          perNamespace = new Map()
          labelSeatCache.set(locale, perNamespace)
        }
        const cached = perNamespace.get(namespace)
        if (cached !== undefined && cached.revision === revision) return cached.t
        const bound = locale.bind(namespace)
        const t = typeof bound === 'function'
          ? (key, params) => bound(key, params)
          : identityTranslate
        perNamespace.set(namespace, { revision, t })
        return t
      } catch {
        return identityTranslate
      }
    }

    /**
     * A `useSyncExternalStore` source over "who owns the label cell".
     *
     * The trigger has to re-read the winner when a connection plugin registers
     * or disposes — otherwise a plugin that loads a second after boot keeps its
     * chip off the trigger until a page reload. The host already publishes the
     * change channel: `slots.subscribe(key, fn)` plus a monotonic `getVersion`,
     * which is the documented uSES pairing (`SlotRegistry.getVersion`).
     *
     * A host without those accessors yields a source that never notifies and
     * always answers 0 — the trigger then simply renders whatever it read on
     * its first paint.
     * @param {object|undefined} slots - the `slots` client service.
     * @returns {{subscribe: Function, getSnapshot: Function}} a stable source.
     */
    const labelSlotSources = new WeakMap()
    function labelSlotSource(slots) {
      const noop = { subscribe: () => () => {}, getSnapshot: () => 0 }
      if (slots === undefined || slots === null || typeof slots !== 'object') return noop
      if (typeof slots.subscribe !== 'function' || typeof slots.getVersion !== 'function') return noop
      const cached = labelSlotSources.get(slots)
      if (cached !== undefined) return cached
      const source = {
        subscribe: listener => slots.subscribe(LABEL_SLOT, listener),
        getSnapshot: () => slots.getVersion(LABEL_SLOT),
      }
      labelSlotSources.set(slots, source)
      return source
    }

    /** The source a seat uses when the face was degraded or omitted. */
    const NO_LABEL_SLOT = { subscribe: () => () => {}, getSnapshot: () => 0 }

    /**
     * How long the pointer must rest on a truncated model name before the
     * marquee starts. Long enough that sweeping across the grid never starts a
     * scroll, short enough to feel like a direct response (DEC-021).
     */
    const MARQUEE_DELAY = 500
    /**
     * One CSS pixel per 20ms — 50px/s. The trailing end of a long name scrolls
     * at the same pace, so a 300px overflow still finishes in ~6s instead of
     * crawling, and the speed reads as a considered crawl rather than a ticker.
     */
    const MARQUEE_PX_PER_SECOND = 50
    /** Shortest pass, so a barely-truncated name does not blink past. */
    const MARQUEE_MIN_MS = 900

    /**
     * Does this element actually clip its text?
     *
     * The measured element is the row's name WINDOW, a plain block-level flex
     * item with `overflow: hidden; white-space: nowrap`, so `scrollWidth` is the
     * full width of the name and `clientWidth` the visible part. A one-pixel
     * slack keeps sub-pixel rounding from starting a marquee on a name that
     * fits exactly.
     * @param {Element | null | undefined} element - the name window.
     * @returns {number} the clipped amount in px; 0 when nothing is cut off.
     */
    const nameClippedBy = element => {
      if (element === null || element === undefined) return 0
      const clientWidth = Number(element.clientWidth) || 0
      if (clientWidth <= 0) return 0
      const clipped = (Number(element.scrollWidth) || 0) - clientWidth
      return clipped > 1 ? clipped : 0
    }

    /**
     * The geometry of the single marquee pass (DEC-021).
     *
     * `shift` is how far the name travels for its LAST glyph to reach the
     * right edge of the window — exactly the clipped amount, so nothing scrolls
     * past the point of being readable. The pass is one-way and eased
     * (ease-in-out), which is symmetric, so its AVERAGE velocity is still the
     * pinned MARQUEE_PX_PER_SECOND: the duration is simply
     * `shift / MARQUEE_PX_PER_SECOND`. Easing makes the ends soften around that
     * average instead of changing it.
     * @param {number} clipped - pixels of the name hidden to the right.
     * @returns {{shift: number, duration: number}} geometry in px / ms.
     */
    const marqueePassGeometry = clipped => {
      const shift = Number.isFinite(clipped) && clipped > 0 ? Math.ceil(clipped) : 0
      if (shift === 0) return { shift: 0, duration: 0 }
      const duration = Math.max(MARQUEE_MIN_MS, Math.round((shift / MARQUEE_PX_PER_SECOND) * 1000))
      return { shift, duration }
    }

    /**
     * Does the user ask the OS to reduce motion? The marquee is decorative, so
     * it is skipped entirely under that preference — the ellipsis and the row
     * tooltip already carry the full name.
     * @returns {boolean} true when motion should be suppressed.
     */
    const prefersReducedMotion = () => {
      try {
        return typeof window !== 'undefined'
          && typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
      } catch {
        return false
      }
    }

    /**
     * The sliding part of a row's primary text.
     *
     * The row wraps it in the clipped window, so the pass runs on the track
     * alone: everything AFTER the window (the variant tail, the catalog badge,
     * the pending spinner) is right-aligned and never pushed along.
     * `shift`/`duration` arrive as inline values because they depend on this
     * row's measurement.
     * @param {object} props - `shift` (px), `duration` (ms), `children`.
     * @returns {object} the track element.
     */
    const renderNameTrack = props => {
      const { shift, duration, children } = props
      const running = shift > 0
      return h('span', {
        className: 'dshmf-rowNameTrack dshmf-rowName',
        'data-running': running ? 'true' : undefined,
        style: running
          ? {
            '--dshmf-marquee-shift': `-${shift}px`,
            '--dshmf-marquee-duration': `${duration}ms`,
          }
          : undefined,
      }, children)
    }

    /**
     * The sliding part of a group title (DEC-023).
     *
     * The band plays the role the row plays for a model name: it is the frame,
     * and it never moves. The text inside is a clipped window holding a track,
     * so a heading too long for its column (`ModelScope Token Plan`) runs the
     * SAME one-pass eased marquee a truncated model name does, while the band's
     * fill, frame, radius and elevation stay put.
     * @param {object} props - `shift` (px), `duration` (ms), `children`.
     * @returns {object} the track element.
     */
    const renderTitleTrack = props => {
      const { shift, duration, children } = props
      const running = shift > 0
      return h('span', {
        className: 'dshmf-groupTitleTrack',
        'data-running': running ? 'true' : undefined,
        style: running
          ? {
            '--dshmf-marquee-shift': `-${shift}px`,
            '--dshmf-marquee-duration': `${duration}ms`,
          }
          : undefined,
      }, children)
    }

    // ---------------------------------------------------------------------
    // Component
    // ---------------------------------------------------------------------
    /**
     * Render the flat model picker seat.
     * @param {object} props - slot standard props + owner `locked` + injected face.
     */
    function ModelFlatMap(props) {
      const {
        locked, sessionId, t,
        available, directory, load, select, resolveText, resolveDirectory,
        teamAvailable, setTeamMode, useProjection, useSession, useSessions,
        insufficient, displayMode, setDisplayMode, nativeAvailable,
      } = props

      // The store may arrive after the first render (the Session binds later),
      // so resolve it on each render and fall back to a stable empty store.
      const resolved = directory === undefined && typeof resolveDirectory === 'function'
        ? resolveDirectory()
        : undefined
      const store = directory ?? resolved?.store ?? EMPTY_STORE

      const subscribe = useCallback(listener => store.subscribe(listener), [store])
      const getSnapshot = useCallback(() => store.getSnapshot(), [store])
      const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

      // Per-model insufficient-balance marks, read from the ONE global store so
      // a failure recorded in any Session or workspace strikes the model here
      // too. The fallback keeps the hook shape stable when the face is omitted.
      const markFace = insufficient ?? EMPTY_INSUFFICIENT
      const subscribeMarks = useCallback(listener => markFace.subscribe(listener), [markFace])
      const getMarks = useCallback(() => markFace.getSnapshot(), [markFace])
      const marks = useSyncExternalStore(subscribeMarks, getMarks, getMarks)

      // The display mode is shared page state, not panel state: the composer-row
      // chip that brings the panel back reads the SAME store while this seat is
      // disposed. The fallback keeps the hook shape stable when the face was
      // degraded.
      const modeFace = displayMode ?? FLAT_DISPLAY_MODE
      const subscribeMode = useCallback(listener => modeFace.subscribe(listener), [modeFace])
      const getMode = useCallback(() => modeFace.getSnapshot(), [modeFace])
      const mode = useSyncExternalStore(subscribeMode, getMode, getMode)
      // Resolved per render: the shipped entry may register after this face was
      // built, and the button has to enable itself without a reload.
      const canGoNative = typeof nativeAvailable === 'function' && nativeAvailable() === true
      // The panel only ever renders while it OWNS the cell, so the stored mode
      // and the visible mode can disagree in exactly one case: `native` was
      // persisted but there is nothing to inherit the cell, so the controller
      // refused to step aside and this panel is still on screen. Reporting the
      // stored value then would paint the button pressed while the panel shows —
      // so report the mode that is actually in effect (DEC-027).
      const modeIsNative = mode === 'native' && canGoNative
      const switchMode = next => {
        if (typeof setDisplayMode === 'function') setDisplayMode(next)
        else modeFace.set(next)
      }

      // Keep the store attached to this Session's feed while the seat is mounted.
      // It is shared, so unmounting must NOT dispose it — the marks belong to the
      // page, not to this seat.
      useEffect(() => {
        if (typeof markFace.watch === 'function') markFace.watch(sessionId)
      }, [markFace, sessionId])

      const [open, setOpen] = useState(false)
      const [query, setQuery] = useState('')
      // The grouping choice is restored from storage so it persists across
      // sessions and workgroups, not just within one panel mount.
      const [grouping, setGrouping] = useState(readGrouping())
      const [selectionFocus, setSelectionFocus] = useState(false)
      const [metrics, setMetrics] = useState({ rowH: 26, headH: 20, fixed: 0, fixedCount: 0, box: null })
      const [teamPending, setTeamPending] = useState(false)
      const [teamFailure, setTeamFailure] = useState(null)
      const [confirming, setConfirming] = useState(false)
      const [replan, setReplan] = useState(0)

      const rootRef = useRef(null)
      const triggerRef = useRef(null)
      const panelRef = useRef(null)
      const searchRef = useRef(null)
      const probeRowRef = useRef(null)
      const probeHeadRef = useRef(null)
      const headRef = useRef(null)
      const errorRef = useRef(null)
      const reasonRef = useRef(null)
      const teamRef = useRef(null)
      const footerRef = useRef(null)
      const teamErrorRef = useRef(null)
      const confirmRef = useRef(null)
      const id = useId()

      // ---- Model-name marquee (DEC-021)
      // A name wider than its row is ellipsised ("DeepSeek Reasone…"). Resting
      // the pointer on such a row for MARQUEE_DELAY starts the marquee; moving
      // away stops it. Only one row can run at a time, and the sliding element
      // is the name TRACK only, so right-aligned trailing content (the catalog
      // badge — 限时免费, ×0.1 — and the pending spinner) never moves.
      // A group title is the same shape one level up (DEC-023): the band is the
      // frame and its text slides inside it, so a truncated heading runs the
      // same pass. Rows and titles therefore share this ONE state machine and
      // are told apart only by their key prefix.
      const [marquee, setMarquee] = useState({ key: '', shift: 0, duration: 0 })
      const marqueeTimer = useRef(null)
      /** The row whose delay is still running; '' when nothing is armed. */
      const marqueeArmed = useRef('')
      const idleMarquee = { key: '', shift: 0, duration: 0 }
      const clearMarqueeTimer = () => {
        if (marqueeTimer.current !== null) {
          clearTimeout(marqueeTimer.current)
          marqueeTimer.current = null
        }
      }
      /** Drop an armed delay (the pointer left before it fired). */
      const disarmMarquee = () => {
        clearMarqueeTimer()
        marqueeArmed.current = ''
      }
      /**
       * Pointer arrived on a marquee-able element. Leave any other one first,
       * then arm the delay. The measurement happens when it fires — the element
       * is laid out by then, and a name that fits never moves.
       * @param {string} key - the row's route key or the title's block key (one runner at a time).
       * @param {Element | null} element - the row (or band) the pointer entered.
       * @param {string} [selector] - the clipped window inside it.
       */
      const enterRow = (key, element, selector = '.dshmf-rowNameWindow') => {
        disarmMarquee()
        marqueeArmed.current = key
        // Leaving the previous row stops its pass immediately.
        setMarquee(previous => (previous.key === '' ? previous : idleMarquee))
        marqueeTimer.current = setTimeout(() => {
          marqueeTimer.current = null
          if (marqueeArmed.current !== key) return
          marqueeArmed.current = ''
          const nameWindow = typeof element?.querySelector === 'function'
            ? element.querySelector(selector)
            : null
          if (prefersReducedMotion()) return
          const geometry = marqueePassGeometry(nameClippedBy(nameWindow))
          if (geometry.shift === 0) return
          setMarquee({ key, shift: geometry.shift, duration: geometry.duration })
        }, MARQUEE_DELAY)
      }
      /**
       * Pointer left a row. An armed delay for THAT row is cancelled (so a
       * quick sweep never starts anything), and a running pass is dropped.
       * @param {string} key - the row the pointer left.
       */
      const leaveRow = key => {
        if (marqueeArmed.current === key) disarmMarquee()
        setMarquee(previous => (previous.key === key ? idleMarquee : previous))
      }
      // Unmount safety: a pending timer must not outlive the seat.
      useEffect(() => () => { clearTimeout(marqueeTimer.current) }, [])

      // Standard props always carry these three hooks for a session-scope slot;
      // the fallbacks keep the component renderable (rather than throwing) in a
      // composition that omits one, and they are plain values so the hook order
      // below never changes.
      const useProjectionSafe = typeof useProjection === 'function' ? useProjection : () => undefined
      const useSessionSafe = typeof useSession === 'function' ? useSession : () => null
      const useSessionsSafe = typeof useSessions === 'function' ? useSessions : () => undefined

      const teamMode = useProjectionSafe('agentTeam')
      const modelSelection = useProjectionSafe('modelSelection')
      // Both hooks may hand back `undefined` before the Session binds, so the
      // selectors never assume an object.
      const addressedChild = useSessionSafe(
        snapshot => snapshot?.subagent != null,
      ) === true
      const listedChild = useSessionsSafe(
        listener => listener?.byId?.[sessionId]?.origin === 'subagent',
      ) === true

      /**
       * Run a pure derivation and degrade instead of throwing.
       *
       * A render-time throw leaves the cell to the boundary, and a shadowing
       * entry that throws twice is worth avoiding: one malformed catalog field
       * must not cost the whole control. The first failure per label is logged.
       * @param label - which derivation failed, for the console.
       * @param run - the derivation.
       * @param fallback - the value to use when it throws.
       * @returns the derived value, or the fallback.
       */
      const derive = (label, run, fallback) => guarded(label, run, fallback)

      // Provider order matches the shipped picker: account, official, catalog order.
      const groups = useMemo(() => derive('grouping providers', () => {
        const ranked = state.groups.map((group, index) => ({ group, index }))
        const rankOf = value => (value.group.id === 'deepseek-account' ? 0
          : value.group.id === 'deepseek-official' ? 1 : 2)
        ranked.sort((left, right) => rankOf(left) - rankOf(right) || left.index - right.index)
        return ranked.map(entry => entry.group)
      }, []), [state.groups])

      /** Provider or family sections, search-filtered; empty groups never appear. */
      const sections = useMemo(() => derive('grouping models', () => {
        const out = []
        /**
         * The provider's display label. Catalog names arrive localized
         * (`{ zh: '豆包(doubao)', en: 'Doubao' }`), so the label is resolved
         * once here and reused as the section title, the search face, and the
         * per-row provider tag. The account provider has no catalog name of
         * its own and borrows the localized "DeepSeek Account" wording.
         * @param {{id: string, name: unknown}} group - one provider entry.
         * @returns {string} a display-ready label; never empty.
         */
        const providerLabelOf = group => providerLabel(group, t, resolveText)
        /**
         * A provider whose own name or id matches the query keeps its whole
         * catalog: `dou` shows the `豆包(doubao)` provider with every model it
         * offers. Models matched by their own name still rank first, so a
         * provider-wide hit only widens the result, never reorders it.
         */
        const providerHitOf = group => providerScore(group, query, providerLabelOf(group))
        /** One model's rank, or null when neither it nor its provider matched. */
        const scoreOf = (model, providerHit) => {
          const byName = matchScore(model.name, query)
          if (byName !== null) return byName
          return providerHit ? PROVIDER_MATCH : null
        }
        if (grouping === 'provider') {
          for (const group of groups) {
            const providerHit = providerHitOf(group) !== null
            const providerLabel = providerLabelOf(group)
            const scored = []
            for (const model of group.models) {
              const score = scoreOf(model, providerHit)
              if (score !== null) {
                scored.push({ entry: { model, providerId: group.id, providerLabel }, score })
              }
            }
            if (scored.length === 0) continue
            scored.sort((left, right) => left.score - right.score)
            out.push({
              key: group.id,
              title: providerLabel,
              models: scored.map(item => item.entry),
            })
          }
          return out
        }
        const buckets = new Map()
        for (const group of groups) {
          const providerHit = providerHitOf(group) !== null
          const providerLabel = providerLabelOf(group)
          for (const model of group.models) {
            const score = scoreOf(model, providerHit)
            if (score === null) continue
            const family = familyOf(model)
            let bucket = buckets.get(family)
            if (bucket === undefined) {
              bucket = { key: family, title: family, scored: [] }
              buckets.set(family, bucket)
            }
            bucket.scored.push({ entry: { model, providerId: group.id, providerLabel }, score })
          }
        }
        const families = [...buckets.values()]
        families.sort((left, right) => familyRank(left.title) - familyRank(right.title)
          || left.title.localeCompare(right.title))
        for (const family of families) {
          family.scored.sort((left, right) => left.score - right.score)
          // Under family grouping each row's primary text is its provider and
          // the family name is NOT repeated (the heading already says it). The
          // heading is only half the picture though: it cannot say WHICH model
          // the row stands for (`Qwen` holds 3.8-Flash-Next and 3.8-27B), nor
          // carry the catalog's rate multiplier (`Deepseek-V4.1-Flash · x0.00`).
          // Both move into a tail at the END of the row, drawn from the model
          // name with the family heading and the provider's own label removed.
          const byProvider = new Map()
          for (const item of family.scored) {
            const list = byProvider.get(item.entry.providerId) ?? []
            list.push(item)
            byProvider.set(item.entry.providerId, list)
          }
          for (const list of byProvider.values()) {
            const used = new Map()
            for (const item of list) {
              // An empty tail is valid: a model whose name says nothing beyond
              // the family and the provider draws no tail at all.
              const variant = rowVariantOf(
                item.entry.model,
                family.title,
                item.entry.providerLabel,
              )
              item.entry.rowVariant = variant
              used.set(variant, (used.get(variant) ?? 0) + 1)
            }
            // Two rows of one provider that still read alike (the same name
            // under different ids) fall back to the unique model id, so no two
            // rows in the grid are indistinguishable.
            if ([...used.values()].some(count => count > 1)) {
              for (const item of list) {
                if (used.get(item.entry.rowVariant) > 1) {
                  item.entry.rowVariant = String(item.entry.model.id ?? '')
                }
              }
            }
          }
          out.push({ key: family.key, title: family.title, models: family.scored.map(item => item.entry) })
        }
        return out
      }, []), [grouping, groups, query, t, resolveText])

      const totalModels = useMemo(
        () => groups.reduce((sum, group) => sum + group.models.length, 0),
        [groups],
      )

      const currentModel = useMemo(() => derive('resolving the current model', () => {
        if (state.current === null) return null
        for (const group of groups) {
          if (group.id !== state.current.provider) continue
          for (const model of group.models) {
            if (model.id === state.current.model) return { group, model }
          }
        }
        return null
      }, null), [groups, state.current])

      const reasoning = currentModel === undefined || currentModel === null
        ? undefined
        : currentModel.model.reasoning
      const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
      const effortLabel = reasoning === undefined
        ? state.retainedEffort
        : effectiveEffort === undefined
          ? t('effort.default')
          : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
      const effortChoices = reasoning === undefined ? [] : reasoning.efforts
      const busy = state.pending !== null

      // What decides which fixed sections EXIST — the measurement effect's
      // dependency set (DEC-026). The derived members are reduced to stable
      // keys so a new array/object identity per render cannot re-arm it.
      //
      // The footer itself is ALWAYS rendered now (it carries the display-mode
      // button), so what can move its height is which of its dynamic members
      // are present — the reasoning group and the teamwork row — not whether
      // the footer exists. Naming the key after those members keeps a footer
      // that merely gains or loses one of them a real measurement, while a
      // footer whose content is unchanged stays quiet.
      const teamRowShown = teamMode !== undefined && teamAvailable()
      const sectionCount = sections.length
      const footerKey = `${effortChoices.length > 0 ? 'reason' : 'none'}:${teamRowShown ? 'team' : 'none'}`
      const errorKey = state.error === null ? '' : state.error
      const confirmOpen = confirming
      const teamErrorKey = teamFailure === null ? '' : teamFailure

      // ---- measurement: probe metrics + fixed-section heights
      // The reasoning group and the teamwork row now share ONE footer flex
      // container, so measure that container once instead of the two children
      // separately: when they sit on the same line the two heights overlap,
      // and summing them would over-subtract from the grid's budget.
      //
      // This effect MUST NOT run on every render (DEC-026). `metrics.fixed`
      // feeds `availableHeight`, which decides the column plan, which changes
      // the panel's own height, which changes the next measurement: an
      // unconditional measure/setMetrics pass closes that into a feedback loop
      // and React aborts it with "Maximum update depth exceeded" (error #185).
      // A browser reaches it on its own — a web font swapping in, a scrollbar
      // appearing, a sub-pixel height drift — which is why the crash looked
      // spontaneous. Measuring is therefore tied to the inputs that can
      // actually move a section (the panel opening, the section list, the
      // locale, and the debounced replan), and the compared values are
      // QUANTIZED so sub-pixel noise can never be mistaken for a new layout.
      useLayoutEffect(() => {
        if (!open) return
        const rowH = quantizeMetric(probeRowRef.current?.getBoundingClientRect().height ?? 26)
        const headH = quantizeMetric(probeHeadRef.current?.getBoundingClientRect().height ?? 20)
        const heights = [headRef, errorRef, footerRef, confirmRef, teamErrorRef]
          .map(ref => quantizeMetric(ref.current?.offsetHeight ?? 0))
          .filter(height => height > 0)
        const fixed = heights.reduce((sum, height) => sum + height, 0)
        const fixedCount = heights.length
        setMetrics(previous => (metricChanged(previous.rowH, rowH)
          || metricChanged(previous.headH, headH)
          || metricChanged(previous.fixed, fixed)
          || previous.fixedCount !== fixedCount
          ? { ...previous, rowH, headH, fixed, fixedCount }
          : previous))
      }, [open, sectionCount, footerKey, errorKey, confirmOpen, teamErrorKey, replan])

      // ---- placement: above the trigger, kept inside the viewport
      //
      // Like the measurement above, this must NOT re-run on every render
      // (DEC-026): `place()` writes `metrics.box`, and the panel's height —
      // which `place()` reads — is derived from `metrics`. Left unconditional,
      // a panel whose height rounds differently at the new position re-places
      // itself forever, which is the same #185 abort the measure loop caused.
      // It is therefore armed on the inputs that move the panel (opening, the
      // plan, the viewport) and observes resize/scroll directly.
      useLayoutEffect(() => {
        if (!open) {
          setMetrics(previous => (previous.box === null ? previous : { ...previous, box: null }))
          return undefined
        }
        const place = () => {
          const trigger = triggerRef.current
          const panel = panelRef.current
          if (trigger === null || panel === null) return
          const rect = trigger.getBoundingClientRect()
          const vw = window.innerWidth
          const vh = window.innerHeight
          const width = Math.max(280, Math.min(560, vw - 24))
          const height = panel.offsetHeight
          const left = Math.max(12, Math.min(rect.right - width, vw - 12 - width))
          let top = rect.top - 8 - height
          if (top < 12) top = Math.min(rect.bottom + 8, Math.max(12, vh - 12 - height))
          setMetrics(previous => {
            const box = previous.box
            if (box !== null && Math.abs(box.left - left) < 0.5
              && Math.abs(box.top - top) < 0.5 && Math.abs(box.width - width) < 0.5) return previous
            return { ...previous, box: { left, top, width } }
          })
        }
        place()
        window.addEventListener('resize', place)
        window.addEventListener('scroll', place, true)
        return () => {
          window.removeEventListener('resize', place)
          window.removeEventListener('scroll', place, true)
        }
        // `plan` is derived from these metrics, so re-placing on the metrics is
        // the same trigger one level up — and it avoids reading `plan` before
        // it is computed.
      }, [open, metrics.fixed, metrics.rowH, metrics.headH, metrics.fixedCount])

      // Re-plan once fonts settle and on panel resize (debounced).
      useEffect(() => {
        if (!open) return undefined
        let timer = 0
        let cancelled = false
        const bump = () => {
          window.clearTimeout(timer)
          timer = window.setTimeout(() => { setReplan(value => value + 1) }, 80)
        }
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(bump) : null
        if (observer !== null && panelRef.current !== null) observer.observe(panelRef.current)
        window.addEventListener('resize', bump)
        if (typeof document !== 'undefined' && document.fonts !== undefined) {
          document.fonts.ready.then(() => { if (!cancelled) setReplan(value => value + 1) })
          document.fonts.addEventListener('loadingdone', bump)
        }
        return () => {
          cancelled = true
          window.clearTimeout(timer)
          observer?.disconnect()
          window.removeEventListener('resize', bump)
          if (typeof document !== 'undefined' && document.fonts !== undefined) {
            document.fonts.removeEventListener('loadingdone', bump)
          }
        }
      }, [open])

      // Dismissal by outside press.
      useEffect(() => {
        if (!open) return undefined
        const onPointerDown = event => {
          if (rootRef.current?.contains(event.target) === true) return
          if (panelRef.current?.contains(event.target) === true) return
          setOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown)
        return () => { document.removeEventListener('mousedown', onPointerDown) }
      }, [open])

      // Opening: reset transient state, refresh the directory, focus search.
      useEffect(() => {
        if (!open) return undefined
        setQuery('')
        setConfirming(false)
        setTeamFailure(null)
        load()
        const timer = window.setTimeout(() => { searchRef.current?.focus() }, 0)
        return () => { window.clearTimeout(timer) }
      }, [open, load])

      const close = useCallback((restoreFocus = false) => {
        setOpen(false)
        setConfirming(false)
        if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
      }, [])

      const submit = useCallback(selection => {
        setSelectionFocus(true)
        triggerRef.current?.focus()
        try {
          void Promise.resolve(select(selection)).catch(() => { /* surfaced on the store */ })
        } catch {
          /* a session that cannot select keeps its previous selection */
        }
      }, [select])

      const chooseModel = useCallback((providerId, model) => {
        if (state.current?.provider === providerId && state.current.model === model.id) {
          close(true)
          return
        }
        submit({ provider: providerId, model: model.id })
      }, [close, state.current, submit])

      const chooseEffort = useCallback(level => {
        if (state.current === null || effectiveEffort === level) return
        submit({
          provider: state.current.provider,
          model: state.current.model,
          reasoningEffort: level,
        })
      }, [effectiveEffort, state.current, submit])

      const applyTeamMode = useCallback(enabled => {
        setTeamPending(true)
        setTeamFailure(null)
        void setTeamMode(enabled).then(result => {
          if (result !== undefined && result.ok === false) {
            const message = result.error?.code === 'session/writer-held'
              ? t('error.sessionInUse')
              : `${result.error?.code ?? 'error'}: ${result.error?.message ?? ''}`
            setTeamFailure(fill(t, 'team.failed', { message }))
          }
        }, error => {
          setTeamFailure(fill(t, 'team.failed', {
            message: error instanceof Error ? error.message : String(error),
          }))
        }).finally(() => { setTeamPending(false) })
      }, [setTeamMode, t])

      const changeTeamMode = useCallback(enabled => {
        if (!enabled && modelSelection !== undefined && modelSelection.lastUsed !== null) {
          setConfirming(true)
          return
        }
        applyTeamMode(enabled)
      }, [applyTeamMode, modelSelection])

      // ---- column planning (the whole point of the layout)
      // The grid is the only flexible child, so the space it may occupy is the
      // panel cap minus padding, every present fixed section, and the flex gaps
      // between them (one gap per fixed section, because the grid always sits
      // between them).
      const availableHeight = PANEL_MAX - PANEL_PAD * 2 - metrics.fixed
        - PANEL_GAP * metrics.fixedCount
      const units = useMemo(
        () => buildUnits(sections, metrics.rowH, metrics.headH),
        [sections, metrics.rowH, metrics.headH],
      )
      const plan = useMemo(
        () => planColumns(units, Math.max(0, availableHeight)),
        [units, availableHeight, replan],
      )

      if (!available) return null
      if (addressedChild || listedChild) return null

      const triggerModel = currentModel === null ? undefined : currentModel.model
      const waiting = currentModel === null && (state.status === 'loading' || state.status === 'idle')
      const modelLabel = waiting
        ? t('trigger.loading')
        : triggerModel?.name ?? t('trigger.fallback')
      const triggerText = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
      const triggerAria = waiting
        ? t('trigger.loading')
        : triggerModel === undefined
          ? t('trigger.fallback')
          : effortLabel === undefined
            ? fill(t, 'trigger.aria', { model: modelLabel })
            : fill(t, 'trigger.ariaEffort', { model: modelLabel, effort: effortLabel })

      const badgeOf = model => {
        const badge = model.badge
        if (badge === undefined || badge === null) return null
        const label = resolveText === undefined ? undefined : resolveText(badge.text)
        if (typeof label !== 'string' || label.trim() === '') return null
        return { label, tone: badge.tone ?? 'neutral' }
      }

      // ---- the trigger's label cell (DEC-030)
      //
      // The shipped picker does not paint a model name on its trigger: it
      // renders the `conversation.input.model.label` slot and lets the winner
      // decorate the name. Connection plugins use that seam for things the
      // catalog does not carry — a promotion chip, a rate, and workbuddy's
      // load mark (one/two/three queued people, or a rocket when idle). Drawing
      // a bare name here therefore loses decoration the native trigger shows.
      //
      // This plugin cannot DECLARE that slot (the shipped entry already did, and
      // a second declaration throws), but it does not need to: the declaration
      // outlives our shadowing entry, so `entriesOfSlot` still names its owner
      // and that owner's component can be rendered directly with the seats it
      // expects. The occupant is third-party code, so the whole cell sits behind
      // its own error boundary — a crashing chip must cost the chip, never the
      // seat.
      const labelSlot = props.labelSlot ?? NO_LABEL_SLOT
      const subscribeLabel = useCallback(listener => labelSlot.subscribe(listener), [labelSlot])
      const getLabelVersion = useCallback(() => labelSlot.getSnapshot(), [labelSlot])
      useSyncExternalStore(subscribeLabel, getLabelVersion, getLabelVersion)
      // Re-read on every render: the winner can change without the version
      // changing (a disposed entry re-elected to its predecessor in the same
      // microtask batch), and the read is a map lookup.
      const labelEntry = typeof props.labelEntry === 'function'
        ? derive('reading the model label slot', () => props.labelEntry(), undefined)
        : undefined
      /**
       * The occupant's own props: the shipped owner share, exactly as the native
       * picker passes it. Memoized on the identity of what it names, so the
       * occupant does not see a "new" provider/model object on every paint.
       */
      const labelOwnerProps = useMemo(() => {
        if (currentModel === null || currentModel === undefined) return undefined
        const group = currentModel.group
        return {
          provider: {
            id: group.id,
            // The catalog's own name, unresolved: the occupant resolves it with
            // its own locale seat, exactly as it does inside the native picker.
            name: group.id === 'deepseek-account' ? t('provider.account') : group.name,
          },
          model: currentModel.model,
          placement: 'trigger',
          selected: true,
        }
      }, [currentModel, t])
      /**
       * The occupant's props, assembled once per (entry, model, label text).
       *
       * The identity has to be stable across renders: the occupant is an
       * ordinary React component, and a fresh props object on every paint makes
       * a memoized one re-render forever. `entry.inject(sessionId)` is the
       * expensive half (it reads services and builds a face), so it is part of
       * the same memo rather than a separate call per render.
       */
      const labelNode = useMemo(() => {
        if (labelEntry === undefined || labelOwnerProps === undefined) return undefined
        const Occupant = labelEntry.component
        const face = typeof props.labelFace === 'function'
          ? derive('building the model label face', () => props.labelFace(labelEntry), {})
          : EMPTY_LABEL_FACE
        const translate = typeof props.labelSeatFor === 'function'
          ? derive('binding the model label locale', () => props.labelSeatFor(labelEntry.locale), identityTranslate)
          : identityTranslate
        return h(LabelBoundary, {
          // Keyed by the winner, so a change of occupant remounts rather than
          // handing one plugin's component another plugin's state.
          key: `label-${labelEntry.options?.id ?? labelEntry.registrant ?? 'entry'}`,
          fallback: undefined,
        }, h(Occupant, { ...face, t: translate, ...labelOwnerProps }))
      }, [labelEntry, labelOwnerProps, props.labelFace, props.labelSeatFor])

      /**
       * What the trigger draws when no label occupant answered: the catalog
       * name, plus the model's own `badge` chip.
       *
       * This is the shipped picker's own fallback (name + `Tag`), reproduced
       * rather than imported — the host's `Tag` lives in a primitives package
       * this plugin does not depend on, and the chip's geometry is four
       * declarations. Drawing the badge here matters even with an occupant
       * installed: an occupant that wins the cell but does not reproduce a
       * sibling's `model.badge` (or no occupant at all) would otherwise lose the
       * promotion marker the native trigger shows.
       */
      const triggerFallbackLabel = () => {
        const badge = triggerModel === undefined ? null : badgeOf(triggerModel)
        if (badge === null) return h('span', { className: 'dshmf-triggerName' }, modelLabel)
        return h('span', { className: 'dshmf-triggerLabel' },
          // The shipped fallback puts the badge BEFORE the name on the trigger
          // and after it in menus; the trigger is what this draws.
          h('span', { className: 'dshmf-triggerBadge', 'data-tone': badge.tone }, badge.label),
          h('span', { className: 'dshmf-triggerName' }, modelLabel),
        )
      }

      /**
       * Split a model name into React children, lifting any "xN" multiplier
       * marker (rate/size tags like "x0.01", "x1.5", "X 2.2") into a smaller,
       * bold span so it reads as an aside while the full name and its order are
       * preserved. Matches an x (any case, or the multiplication sign) that
       * STARTS a token — preceded by start-of-string or a non-word character,
       * so it is not embedded in a word like "GenX5" — followed by optional
       * whitespace and a number (integer or decimal, optional leading +).
       * "Claude x3", "GPT x0.1", "Model X 2.2" all get the run; a plain
       * "Model X" (no number) or "GenX5" (x inside a word) do not.
       */
      const MULT_MARKER = /(?<![\p{L}\p{N}])[xX×]\s*[+]?\d+(?:\.\d+)?/gu
      const nameRuns = rawName => {
        const name = String(rawName ?? '')
        const out = []
        let cursor = 0
        for (const m of name.matchAll(MULT_MARKER)) {
          if (m.index > cursor) out.push(name.slice(cursor, m.index))
          out.push(h('span', { className: 'dshmf-rowNameMark' }, m[0]))
          cursor = m.index + m[0].length
        }
        if (cursor < name.length) out.push(name.slice(cursor))
        return out
      }

      const renderRow = entry => {
        const { model, providerId, providerLabel, rowVariant } = entry
        const selected = state.current?.provider === providerId && state.current.model === model.id
        const pendingThis = state.pending?.provider === providerId && state.pending.model === model.id
        const badge = badgeOf(model)
        /**
         * Under family grouping the heading already says what the models ARE,
         * so the family name is not repeated in a row. The row's primary text
         * is the PROVIDER — the one thing a heading cannot tell you when a
         * family spans providers. Only when one provider offers several models
         * in this family does a short variant tail differentiate them. Under
         * provider grouping the heading IS the provider, so the primary text
         * stays the model name and no secondary tag is drawn.
         */
        const familyMode = grouping === 'family'
        const primary = familyMode && typeof providerLabel === 'string' && providerLabel !== ''
          ? providerLabel : String(model.name ?? '')
        const showVariant = familyMode && typeof rowVariant === 'string' && rowVariant !== ''
        const rowTitle = model.description === undefined
          ? `${model.name}\n${providerLabel}`
          : `${model.name}\n${model.description}\n${providerLabel}`
        // The model's last call ran out of balance and nothing has cleared it
        // yet: the row text is struck through until a later call for the same
        // model route returns anything else.
        const insufficientRoute = marks.marks.get(routeKeyOf(providerId, model.id)) === true
        // The marquee runs one row at a time, keyed by the model route so a
        // re-render cannot start the wrong row (DEC-021).
        const routeKey = `${providerId}/${model.id}`
        const running = marquee.key === routeKey
        return h('button', {
          key: routeKey,
          type: 'button',
          className: 'dshmf-row',
          'aria-pressed': selected,
          'data-insufficient': insufficientRoute ? 'true' : undefined,
          title: rowTitle,
          disabled: busy,
          onClick: () => { chooseModel(providerId, model) },
          // The pointer must REST for MARQUEE_DELAY before anything moves, so
          // sweeping across the grid never triggers it. Measuring happens in
          // the timeout, when the row is laid out and the panel is settled.
          onMouseEnter: event => { enterRow(routeKey, event?.currentTarget) },
          onMouseLeave: () => { leaveRow(routeKey) },
          // Keyboard focus counts as "resting on the row" for the same reason
          // the tooltip does: a focused row is one the user is looking at.
          onFocus: event => { enterRow(routeKey, event?.currentTarget) },
          onBlur: () => { leaveRow(routeKey) },
        },
          // `nameRuns` (xN multiplier markers) is applied to whatever the
          // primary text is: the model name under provider grouping, or the
          // provider name under family grouping. Only the track (inside the
          // clipped window) moves; the variant tail, the badge and the spinner
          // are siblings AFTER the window and stay put on the right.
          h('span', { className: 'dshmf-rowNameWindow' },
            running
              ? renderNameTrack({ shift: marquee.shift, duration: marquee.duration, children: nameRuns(primary) })
              : h('span', { className: 'dshmf-rowNameTrack dshmf-rowName' }, ...nameRuns(primary)),
          ),
          // The model-specific tail sits at the END of the row, after the
          // primary text: the heading already names the family, and the
          // provider is the primary text, so what is LEFT is the型号 and the
          // multiplier (`3.8-Flash-Next`, `V4.1-Flash · x0.01`). It runs
          // through `nameRuns` too, so a multiplier in the tail keeps the
          // same two-sizes-smaller treatment it gets inside a model name.
          // It shrinks before the primary text and never wraps.
          showVariant ? h('span', {
            className: 'dshmf-rowProvider',
            title: rowVariant,
          }, ...nameRuns(rowVariant)) : null,
          badge === null ? null : h('span', {
            className: 'dshmf-badge',
            'data-tone': badge.tone,
          }, badge.label),
          pendingThis ? h('span', { className: 'dshmf-rowTail' }, h('span', { className: 'dshmf-spin' })) : null,
        )
      }

      const showEmptyState = sections.length === 0 && !busy
      const emptyKey = state.status === 'loading' && totalModels === 0
        ? 'status.loading'
        : totalModels === 0 ? 'empty.models' : 'empty.search'

      // A group title is a marquee-able band like a model row (DEC-023): the
      // band itself is the frame and never moves, while its text sits in a
      // clipped window around a track that slides on hover when the heading
      // does not fit its column. Titles and rows share one state machine, keyed
      // by `block.key` (`t:…`) versus a row's route key, so only one thing in
      // the whole panel scrolls at a time. The band keeps its `title` tooltip
      // for the hover case the OS tooltip covers.
      const renderTitle = block => {
        const running = marquee.key === block.key
        return h('div', {
          className: 'dshmf-groupTitle',
          key: block.key,
          title: block.label,
          // A heading has no action of its own: these handlers only arm the
          // marquee, so keyboard focus is deliberately NOT a trigger.
          onMouseEnter: event => { enterRow(block.key, event?.currentTarget, '.dshmf-groupTitleWindow') },
          onMouseLeave: () => { leaveRow(block.key) },
        },
          h('span', { className: 'dshmf-groupTitleWindow' },
            running
              ? renderTitleTrack({ shift: marquee.shift, duration: marquee.duration, children: block.label })
              : h('span', { className: 'dshmf-groupTitleTrack' }, block.label),
          ),
        )
      }

      const renderBlock = block => (block.kind === 'title'
        ? renderTitle(block)
        : renderRow(block.entry))

      // Each child is placed EXPLICITLY (`grid-column` below), never by
      // auto-placement: a divider that pinned its row but not its column was
      // laid out first, took column 1, and pushed the columns into columns 2
      // and 3 — which squashed the first text column to 1px and stacked the
      // columns on top of each other. Track 2k+1 holds column k (0-based) and
      // track 2k+2 the gutter that follows it, so a 3-column layout is
      // col gutter col gutter col.
      const renderColumn = (column, columnIndex) => h('div', {
        className: 'dshmf-col',
        key: `col-${columnIndex}`,
        style: { gridColumn: String(columnIndex * 2 + 1), gridRow: '1' },
      }, column.map(unit => unit.blocks.map(renderBlock)))

      // Vertical separators are siblings of the columns, not a border on one
      // of them: a border can only ever be as tall as its own column, while a
      // grid item can stretch to the whole grid height (see .dshmf-colDivider).
      // Called with the index of the column that PRECEDES the gutter.
      const renderDivider = dividerIndex => h('div', {
        className: 'dshmf-colDivider',
        role: 'presentation',
        key: `gutter-${dividerIndex}`,
        style: { gridColumn: String(dividerIndex * 2), gridRow: '1' },
      })

      const renderColumns = () => {
        const children = []
        plan.columns.forEach((column, columnIndex) => {
          if (columnIndex > 0) children.push(renderDivider(columnIndex))
          children.push(renderColumn(column, columnIndex))
        })
        return children
      }

      // `minmax(0, 1fr)` per column, a hairline track per gutter between them.
      const gridTemplateColumns = plan.columns
        .map(() => 'minmax(0, 1fr)')
        .join(' 1px ')

      const renderFailure = failure => h('div', {
        className: 'dshmf-failure',
        key: `failure-${failure.id}`,
        role: 'status',
      }, fill(t, 'failure.group', {
        name: failure.id === 'deepseek-account' ? t('provider.account') : failure.name,
        message: failure.message,
      }))

      const onPanelKeyDown = event => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        if (confirming) {
          setConfirming(false)
          return
        }
        close(true)
      }

      // Radio-group keyboard: arrows move the exclusive selection to the
      // neighbouring enabled level, so the whole group is reachable by keys.
      const onEffortKeyDown = event => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown'
          && event.key !== 'ArrowLeft' && event.key !== 'ArrowUp') return
        const pills = reasonRef.current
          ? [...reasonRef.current.querySelectorAll('button.dshmf-pill:not(:disabled)')]
          : []
        if (pills.length === 0) return
        event.preventDefault()
        const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
        const at = event.target instanceof Element ? pills.indexOf(event.target) : -1
        const next = at === -1
          ? pills[forward ? 0 : pills.length - 1]
          : pills[(at + (forward ? 1 : -1) + pills.length) % pills.length]
        next?.focus()
        next?.click()
      }

      return h('div', {
        className: 'dshmf-root',
        ref: rootRef,
        onMouseDown: event => {
          // WebKit blurs a focused row before click unless mousedown keeps focus.
          if (event.target instanceof Element && event.target.closest('button') !== null) event.preventDefault()
        },
      },
        h('button', {
          ref: triggerRef,
          type: 'button',
          className: 'dshmf-trigger',
          'aria-label': triggerAria,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-controls': open ? `${id}-panel` : undefined,
          title: triggerText,
          'aria-busy': busy,
          'data-selection-focus': selectionFocus ? '' : undefined,
          disabled: locked,
          onBlur: () => { setSelectionFocus(false) },
          onClick: () => {
            if (open) {
              close(true)
              return
            }
            setSelectionFocus(false)
            triggerRef.current?.focus()
            // Opening the panel IS showing the models: ask the store to re-read
            // the clock first, so a strike that went stale while the panel was
            // closed is gone from the rows this click draws (DEC-024).
            if (typeof markFace.refresh === 'function') markFace.refresh()
            setOpen(true)
          },
        },
          svg(PATH_MODELS, 16, { className: 'dshmf-triggerIcon' }),
          h('span', { className: 'dshmf-triggerText' },
            labelNode === undefined ? triggerFallbackLabel() : labelNode),
          effortLabel === undefined ? null : h('span', { className: 'dshmf-triggerEffort' }, effortLabel),
          busy
            ? h('span', { className: 'dshmf-spin' })
            : svg(PATH_CHEVRON, 12, { className: `dshmf-chevron${open ? ' dshmf-chevronOpen' : ''}` }),
        ),

        open ? ReactDOM.createPortal(
          h('div', {
            ref: panelRef,
            id: `${id}-panel`,
            className: 'dshmf-panel',
            style: {
              left: `${metrics.box?.left ?? 12}px`,
              top: `${metrics.box?.top ?? 12}px`,
              width: `${metrics.box?.width ?? 320}px`,
            },
            role: 'dialog',
            'aria-label': t('panel.aria'),
            onKeyDown: onPanelKeyDown,
          },
            // ---- fixed: search + grouping segment
            h('div', { className: 'dshmf-head', ref: headRef },
              h('div', { className: 'dshmf-search' },
                h('input', {
                  ref: searchRef,
                  className: 'dshmf-input',
                  type: 'text',
                  role: 'searchbox',
                  'aria-label': t('search.placeholder'),
                  placeholder: t('search.placeholder'),
                  value: query,
                  readOnly: busy,
                  onChange: event => { setQuery(event.target.value) },
                }),
                state.status === 'loading'
                  ? h('span', { className: 'dshmf-spin', title: t('status.loading') })
                  : null,
                query === '' ? null : h('button', {
                  type: 'button',
                  className: 'dshmf-clear',
                  'aria-label': t('search.clear'),
                  title: t('search.clear'),
                  onClick: () => {
                    setQuery('')
                    searchRef.current?.focus()
                  },
                }, svg(PATH_CLOSE, 10)),
              ),
              h('div', { className: 'dshmf-seg', role: 'group', 'aria-label': t('group.aria') },
                h('button', {
                  type: 'button',
                  className: 'dshmf-segBtn',
                  'aria-pressed': grouping === 'provider',
                  title: t('group.provider'),
                  onClick: () => { setGrouping('provider'); writeGrouping('provider') },
                }, t('group.provider')),
                h('button', {
                  type: 'button',
                  className: 'dshmf-segBtn',
                  'aria-pressed': grouping === 'family',
                  title: t('group.family'),
                  onClick: () => { setGrouping('family'); writeGrouping('family') },
                }, t('group.family')),
              ),
            ),

            // ---- fixed: failure strip above the grid, so it never competes
            // with model rows for the scroll area
            state.error === null ? null : h('div', {
              className: 'dshmf-error',
              ref: errorRef,
              role: 'status',
            }, fill(t, 'error.action', {
              message: state.error.includes('session/writer-held')
                ? t('error.sessionInUse')
                : state.error,
            })),

            // ---- the only scrolling region
            h('div', {
              className: 'dshmf-grid',
              style: {
                gridTemplateColumns: showEmptyState
                  ? 'minmax(0, 1fr)'
                  : gridTemplateColumns,
                columnGap: `${COL_GAP}px`,
              },
            },
              showEmptyState
                ? h('div', { className: 'dshmf-empty', role: 'status' }, t(emptyKey))
                : renderColumns(),
              state.failures.length === 0 ? null : state.failures.map(renderFailure),
            ),

            // ---- fixed, bottom: the adaptive footer.
            // It ALWAYS renders now: the reasoning group, the teamwork row and
            // the display-mode button live in ONE flex container, and the mode
            // button is the one member that is always present (the other two
            // come and go with the model and the remote scope). They share a
            // line when they fit with the 30px gap, otherwise each takes its own
            // line; the mode button is pushed to the trailing edge.
            h('div', { className: 'dshmf-footer', ref: footerRef },
                effortChoices.length === 0 ? null : h('div', {
                  className: 'dshmf-reason',
                  ref: reasonRef,
                  role: 'radiogroup',
                  'aria-labelledby': `${id}-effort-label`,
                  onKeyDown: onEffortKeyDown,
                },
                  h('span', {
                    className: 'dshmf-reasonLabel',
                    id: `${id}-effort-label`,
                    title: t('effort.hint'),
                  }, svg(PATH_SPARK, 12), t('effort.label')),
                  h('div', { className: 'dshmf-pills' }, effortChoices.map(level => {
                    const selected = effectiveEffort === level.id
                    const pendingThis = state.pending !== null
                      && state.pending.provider === state.current?.provider
                      && state.pending.model === state.current.model
                      && state.pending.reasoningEffort === level.id
                    return h('button', {
                      key: level.id,
                      type: 'button',
                      role: 'radio',
                      className: 'dshmf-pill',
                      'aria-checked': selected,
                      title: level.description ?? level.name,
                      disabled: busy || state.current === null,
                      onClick: () => { chooseEffort(level.id) },
                    }, pendingThis
                      ? h('span', { className: 'dshmf-spin' })
                      : h('span', { className: 'dshmf-pillName' }, level.name))
                  })),
                ),
                teamMode === undefined || !teamAvailable()
                  ? null
                  : h('div', { className: 'dshmf-team', ref: teamRef },
                    h('span', { className: 'dshmf-teamLabel' },
                      h('span', { className: 'dshmf-teamName' }, t('team.label')),
                      h('span', {
                        className: 'dshmf-info',
                        title: t('team.description'),
                        'aria-hidden': 'true',
                      }, svg(PATH_INFO, 12)),
                    ),
                    h('button', {
                      type: 'button',
                      role: 'switch',
                      className: 'dshmf-switch',
                      'aria-checked': teamMode.enabled,
                      'aria-label': t('team.label'),
                      title: t('team.description'),
                      disabled: locked || busy || teamPending || modelSelection === undefined,
                      onClick: () => { changeTeamMode(!teamMode.enabled) },
                    }, h('span', { className: 'dshmf-thumb' })),
                  ),

                // ---- display mode: hand the seat back to the Host's own
                // picker, or take it back. One button, `aria-pressed` carrying
                // the state. It is the footer's trailing member, so an auto left
                // margin pins it to the panel's bottom-right and the wrap rule
                // keeps every other member left-aligned.
                // Disabled while the Host ships no picker to hand over to — a
                // seat nobody would take must never empty the composer.
                // Clicking TOGGLES: a pressed button means native mode is in
                // effect, so it must offer the way back rather than re-assert
                // the mode that is already on.
                h('button', {
                  type: 'button',
                  className: 'dshmf-modeBtn',
                  'aria-pressed': modeIsNative,
                  'aria-label': modeIsNative
                    ? t('native.back')
                    : (canGoNative ? t('native.enter') : t('native.unavailable')),
                  title: modeIsNative
                    ? t('native.back')
                    : (canGoNative ? t('native.enter') : t('native.unavailable')),
                  disabled: !canGoNative,
                  onClick: () => { switchMode(modeIsNative ? 'flat' : 'native') },
                }, t('native.label')),
              ),

            // ---- fixed: teamwork disable confirmation
            confirming ? h('div', {
              className: 'dshmf-confirm',
              ref: confirmRef,
              role: 'alertdialog',
              'aria-label': t('team.disable.title'),
            },
              h('span', { className: 'dshmf-confirmTitle' }, t('team.disable.title')),
              h('span', { className: 'dshmf-confirmBody' },
                `${t('team.disable.description')} ${t('team.disable.warning')}`),
              h('div', { className: 'dshmf-confirmActions' },
                h('button', {
                  type: 'button',
                  className: 'dshmf-confirmBtn',
                  onClick: () => { setConfirming(false) },
                }, t('team.disable.cancel')),
                h('button', {
                  type: 'button',
                  className: 'dshmf-confirmBtn',
                  'data-primary': 'true',
                  onClick: () => {
                    setConfirming(false)
                    applyTeamMode(false)
                  },
                }, t('team.disable.confirm')),
              ),
            ) : null,

            // ---- fixed: teamwork failure strip
            teamFailure === null ? null : h('div', {
              className: 'dshmf-error',
              ref: teamErrorRef,
              role: 'status',
            }, teamFailure),

            // ---- measurement probe (never painted). It mirrors a family-
            // grouped row (provider primary + model-specific tail) and a group
            // title, the two shapes the grid can draw, so the measured row and
            // head heights cover every mode. Both now use the window/track
            // split (DEC-021, DEC-023), so the probe mirrors that too — a track
            // inside a clipped window is what the grid actually sizes. It
            // carries no badge and no spinner: the selected row is a filled band
            // now and the spinner is only drawn for a pending selection.
            h('div', { className: 'dshmf-probe', 'aria-hidden': 'true' },
              h('div', { ref: probeHeadRef, className: 'dshmf-groupTitle' },
                h('span', { className: 'dshmf-groupTitleWindow' },
                  h('span', { className: 'dshmf-groupTitleTrack' }, 'X'))),
              h('div', { ref: probeRowRef, className: 'dshmf-row' },
                h('span', { className: 'dshmf-rowNameWindow' },
                  h('span', { className: 'dshmf-rowNameTrack dshmf-rowName' }, 'X')),
                h('span', { className: 'dshmf-rowProvider' }, 'X'),
              ),
            ),
          ),
          document.body,
        ) : null,
      )
    }

    // ---------------------------------------------------------------------
    // Label boundary
    // ---------------------------------------------------------------------
    /**
     * Keep the trigger alive when the label cell's occupant fails.
     *
     * The occupant is another plugin's component, rendered here on the
     * documented owner-props contract but without the renderer's own per-entry
     * error boundary. It can therefore throw on a host whose props differ from
     * the ones it was written for, or on data it did not expect. Catching it
     * here costs the decoration, never the seat: the caller's `fallback` is
     * `undefined`, which makes the trigger draw the catalog name exactly as the
     * shipped picker does when the cell has no occupant.
     *
     * The report is once per failure, not once per render — a chip that throws
     * on every paint would otherwise flood the console.
     */
    class LabelBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error, info) {
        console.error('dsh-model-flatmap: the model label slot failed; the trigger falls back to the catalog name', error, info)
      }

      render() {
        if (this.state.failed) return this.props.fallback ?? null
        return this.props.children
      }
    }

    // ---------------------------------------------------------------------
    // Seat boundary
    // ---------------------------------------------------------------------
    /**
     * Keep the composer seat alive when its content fails.
     *
     * A shadowing slot entry that throws during render abdicates, and the cell
     * falls to the next registration — the native picker reappears and this
     * plugin looks like it never installed. Catching here turns any failure into
     * a small visible chip, so the seat never disappears and the reason stays in
     * the console.
     */
    class SeatBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failure: null }
      }

      static getDerivedStateFromError(error) {
        return { failure: error instanceof Error ? error : new Error(String(error)) }
      }

      componentDidCatch(error, info) {
        console.error('dsh-model-flatmap: the model seat failed and fell back to a minimal control', error, info)
      }

      render() {
        const { failure } = this.state
        if (failure === null) return this.props.children
        const label = this.props.label ?? 'Model'
        // The reason is shown, not just logged: without browser console access a
        // silent fallback is indistinguishable from "the plugin never installed".
        const reason = String(failure && failure.message ? failure.message : failure)
        return h('div', { className: 'dshmf-root' },
          h('button', {
            type: 'button',
            className: 'dshmf-trigger',
            disabled: true,
            title: `${label}: ${reason}`,
            'aria-label': `${label} — ${reason}`,
          },
            svg(PATH_MODELS, 16, { className: 'dshmf-triggerIcon' }),
            h('span', { className: 'dshmf-triggerText' }, `${label}: ${reason.slice(0, 90)}`),
          ),
        )
      }
    }

    /** Labels whose derivation failure has already been reported. */
    const reportedDerivations = new Set()

    /**
     * Run a pure derivation and degrade instead of throwing.
     * @param label - which derivation failed, for the console.
     * @param run - the derivation.
     * @param fallback - the value to use when it throws.
     * @returns the derived value, or the fallback.
     */
    function guarded(label, run, fallback) {
      try {
        return run()
      } catch (error) {
        if (!reportedDerivations.has(label)) {
          reportedDerivations.add(label)
          console.error(`dsh-model-flatmap: ${label} failed; the panel degrades`, error)
        }
        return fallback
      }
    }

    /**
     * The registered seat: a boundary around the panel, so a content failure
     * cannot remove the entry from the slot.
     * @param props - the slot's standard props plus the injected face.
     */
    function Seat(props) {
      const translate = typeof props.t === 'function' ? props.t : key => key
      return h(SeatBoundary, { label: translate('trigger.fallback') },
        h(ModelFlatMap, props))
    }

    /**
     * The way back out of native mode.
     *
     * Native mode DISPOSES this plugin's `conversation.input.model` entry, so
     * the footer button that switched it disappears with the panel. This row
     * rides the HOST picker's own root menu instead: `conversation.input.model.
     * options` is the list child slot the shipped `ModelSelect` declares and
     * renders right after its Model / Effort rows, so the control appears at
     * the bottom of the native picker's own panel — the one place that both
     * survives the seat's disposal AND belongs to the control it acts on. No
     * host component is rendered, imported or copied; the slot is a public
     * declaration of the installed package.
     *
     * It renders NOTHING unless native mode is in effect, so the shipped menu
     * looks exactly as shipped while the flat panel is the one on screen.
     *
     * Visually it is NOT a menu row. Every row above it answers "which value?";
     * this one performs an action, so it sits below a separator rule and is
     * drawn as an outlined push button. The slot gives us only a
     * `display: contents` anchor, so the whole box is ours to style.
     *
     * It reads the same page-wide store as the panel's footer button, so a
     * switch made here is the switch the panel sees when it comes back.
     * @param props - the slot's standard props plus the injected mode face.
     */
    function NativeMenuRow(props) {
      const {
        t, displayMode, setDisplayMode, nativeAvailable, dismiss,
      } = props
      const modeFace = displayMode ?? FLAT_DISPLAY_MODE
      const subscribeMode = useCallback(listener => modeFace.subscribe(listener), [modeFace])
      const getMode = useCallback(() => modeFace.getSnapshot(), [modeFace])
      const mode = useSyncExternalStore(subscribeMode, getMode, getMode)
      // The panel's own business: this row exists only while the Host's picker
      // is the seat on screen.
      if (mode !== 'native') return null
      const canGoFlat = typeof nativeAvailable !== 'function' || nativeAvailable() === true
      if (!canGoFlat) return null
      const translate = typeof t === 'function' ? t : key => key
      // A band whose top rule separates an ACTION from the value rows above it,
      // then a full-width outlined button inside. Keeping the anchor full-width
      // is what makes the rule span the menu; the button is what reads as
      // something to press rather than something to choose.
      return h('div', { className: 'dshmf-modeAction' },
        h('button', {
          type: 'button',
          className: 'dshmf-modeBtnRow',
          title: translate('native.back'),
          onClick: () => {
            // Let the host close its own menu before switching: the switch
            // disposes the entry that owns this menu, and closing on the host's
            // own terms (its state, its listener cleanup, its focus handoff)
            // beats having a portaled menu unmount underneath the click.
            if (typeof dismiss === 'function') dismiss()
            if (typeof setDisplayMode === 'function') setDisplayMode('flat')
            else modeFace.set('flat')
          },
        },
          svg(PATH_GRID, 13, { className: 'dshmf-modeBtnRowIcon' }),
          h('span', { className: 'dshmf-modeBtnRowLabel' }, translate('native.back'))))
    }

    // ---------------------------------------------------------------------
    // Plugin
    // ---------------------------------------------------------------------
    return {
      // `remote.agentTeams` is a SEPARATE client service (the gateway installs
      // each remote namespace as its own service). Reading it through a bare
      // `ctx.get('remote')` property lookup is refused by the guarded client
      // context unless both names are declared here, and a swallowed refusal
      // used to leave `teamAvailable` permanently false — i.e. the host's
      // teamwork switch never rendered at all.
      inject: ['slots', 'locale', 'remote', 'remote.agentTeams', 'sessions'],
      // Pure layout and grouping derivations plus the component itself,
      // exposed for `node --test` so grouping, filtering and the column
      // algorithm are pinned without a browser. The shell never reads this key.
      __test: { marqueePassGeometry, nameClippedBy, MARQUEE_DELAY, MARQUEE_PX_PER_SECOND, MARQUEE_MIN_MS, familyOf, familyRank, familyVariant: rowVariantOf, idVariantOf, matchScore, providerScore, searchTokens, buildUnits, columnHeight, packColumns, planColumns, readGrouping, writeGrouping, GROUPING_KEY, GROUPING_DEFAULT, readDisplayMode, writeDisplayMode, createDisplayModeStore, DISPLAY_MODE_KEY, DISPLAY_MODE_DEFAULT, FLAT_DISPLAY_MODE, isInsufficientBalance, decideMark, eventTimeOf, foldInsufficient, foldMarkEntry, routeOfHeader, routeKeyOf, MARKS_KEY, MARKS_TTL, STRIKE_TTL, markIsLive, parseMarks, serializeMarks, readMarks, writeMarks, createMarkStore, quantizeMetric, metricChanged, METRIC_HYSTERESIS, LabelBoundary, readLabelEntry, labelSeat, labelSlotSource, LABEL_SLOT, providerLabel },
      __component: ModelFlatMap,
      __seat: Seat,
      __nativeMenuRow: NativeMenuRow,
      apply(ctx) {
        const read = name => {
          try {
            return typeof ctx.get === 'function' ? ctx.get(name) : undefined
          } catch {
            return undefined
          }
        }

        // Dictionary registration must never be able to take the seat down: a
        // namespace left behind by a previous module generation throws on
        // re-registration, and losing the copy is far better than losing the
        // control.
        try {
          const locale = read('locale')
          if (locale !== undefined && typeof locale.register === 'function') {
            ctx.effect(() => locale.register(NS, dict), 'dsh-model-flatmap: dictionaries')
          }
        } catch (error) {
          console.error('dsh-model-flatmap: dictionaries were not registered', error)
        }

        const resolveText = value => {
          try {
            const locale = read('locale')
            return locale === undefined ? fallbackText(value) : locale.resolveText(value)
          } catch {
            return fallbackText(value)
          }
        }

        // Services are read at CALL time, never captured once: a client reload
        // replaces them, and a value captured during activation then throws
        // forever. `slots.inject` additionally waits for the declaration, so the
        // registration below runs exactly when the seat exists.
        const slots = read('slots')
        if (slots === undefined || typeof slots.inject !== 'function') return

        // The teamwork switch is driven by the Host's own `remote.agentTeams`
        // namespace service. The gateway installs each remote namespace as its
        // OWN service, so it is read by full name through `ctx.get`, never as a
        // property of the `remote` service (a bare `ctx.remote` lookup is
        // refused by the guarded client context, and the old try/catch turned
        // that refusal into a silent `undefined` — which hid the switch
        // forever). `ctx.inject` is not among the client facade's verbs, so the
        // handle is resolved lazily on every use instead of once at activation.
        const readTeamService = () => {
          try {
            return typeof ctx.get === 'function' ? ctx.get('remote.agentTeams') : undefined
          } catch {
            return undefined
          }
        }

        // ---- the GLOBAL insufficient-balance store
        //
        // Created once per activation and shared by every seat, because the
        // balance state belongs to the model route (and its account), not to one
        // conversation or workspace. It observes every Session the list names,
        // persists to `localStorage`, and starts from what the last page load
        // recorded. A failure to build it degrades to an empty face rather than
        // costing the control.
        let markStore
        try {
          markStore = createMarkStore({
            sessionsOf: () => {
              try {
                return typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
              } catch {
                return undefined
              }
            },
            readStored: readMarks,
            writeStored: writeMarks,
          })
          ctx.effect(() => () => { markStore.dispose() }, 'dsh-model-flatmap: balance marks')
        } catch (error) {
          console.error('dsh-model-flatmap: the balance mark store failed to start', error)
          markStore = undefined
        }

        // ---- the display-mode store (flat panel vs the Host's own picker)
        //
        // One store per activation, shared by the panel's footer button and the
        // composer-row chip that outlives it. `readDisplayMode` already returned
        // `flat` for a missing or unreadable store, so a persistence failure
        // costs the memory of the choice, never the control.
        let modeStore
        try {
          modeStore = createDisplayModeStore({
            readStored: readDisplayMode,
            writeStored: writeDisplayMode,
          })
          ctx.effect(() => () => { modeStore.dispose?.() }, 'dsh-model-flatmap: display mode')
        } catch (error) {
          console.error('dsh-model-flatmap: the display mode store failed to start', error)
          modeStore = createDisplayModeStore({ readStored: () => DISPLAY_MODE_DEFAULT })
        }

        /**
         * Every OTHER live registration in the model seat.
         *
         * A `single` slot keeps every registration and elects the highest
         * priority; this plugin only owns the cell because it registers at a
         * negative priority. Disposing our own entry therefore hands the cell to
         * whatever is underneath — normally the shipped `ModelSelect` — with no
         * copy, import or re-mount, so an upgraded DSH shows its own newest
         * picker (DEC-027).
         * @returns the competing entries, or `undefined` when the Host cannot
         *   enumerate them (an older version): unverifiable means "do not step
         *   aside", never a blank composer.
         */
        const otherEntries = () => {
          try {
            if (typeof slots.entries !== 'function') return undefined
            const all = slots.entries('conversation.input.model')
            if (!Array.isArray(all)) return undefined
            return all.filter(entry => entry?.component !== Seat)
          } catch {
            return undefined
          }
        }
        /**
         * May the panel hand the seat over? Only when another live entry exists
         * to inherit it. Deliberately does NOT require the shipped package name:
         * a composed profile may legitimately elect another plugin's seat, and
         * that is exactly what the user asked to see.
         * @returns whether disposing this entry leaves a model control behind.
         */
        const canStepAside = () => {
          const others = otherEntries()
          return others !== undefined && others.length > 0
        }
        /** Report the inheriting entry once, so a support log names the target. */
        let inheritReported = false
        const reportInherit = () => {
          if (inheritReported) return
          inheritReported = true
          try {
            const others = otherEntries()
            const names = (others ?? []).map(entry => entry?.registrant ?? entry?.options?.id ?? 'unknown')
            console.info(`dsh-model-flatmap: the model seat is handed to ${names.join(', ') || 'no entry'}`)
          } catch {
            /* diagnostics only */
          }
        }

        /**
         * Build the injected face for one Session.
         * @param sessionId - the Session this seat renders for.
         * @returns the face the seat component receives.
         */
        const buildFace = sessionId => {
          // Every capability is resolved per call, so a Session that binds late,
          // or a reloaded service, is picked up without tearing the seat down.
          const safeRead = name => {
            try {
              return read(name)
            } catch {
              return undefined
            }
          }
          const models = safeRead('modelDirectories')
          const sessions = safeRead('sessions')

          const resolve = () => {
            try {
              // `subagentAddress` is the documented way to tell an addressed
              // child from an ordinary Session; without it, treat the Session as
              // selectable rather than blanking the composer.
              if (typeof sessions?.subagentAddress === 'function'
                && sessions.subagentAddress(sessionId) !== undefined) {
                return { addressed: true }
              }
              if (models === undefined || typeof models.directoryFor !== 'function') {
                return { addressed: false, pending: 'modelDirectories unavailable' }
              }
              const directory = models.directoryFor(sessionId)
              return { addressed: false, directory, store: directory.store }
            } catch (error) {
              return { addressed: false, pending: error instanceof Error ? error.message : String(error) }
            }
          }
          const first = resolve()

          // Attach this Session's feed as soon as its seat exists, not only
          // when a subscriber appears: the seat always subscribes, but the
          // face is built before the first render, and a feed that is already
          // live should contribute its history immediately.
          if (markStore !== undefined) {
            try {
              markStore.watch(sessionId)
            } catch {
              /* the store degrades to storage-only state */
            }
          }

          return {
            sessionId,
            resolveDirectory: resolve,
            safeRead,
            // The GLOBAL mark store, shared by every seat of this plugin
            // generation. `subscribe` additionally attaches the store to this
            // Session's feed, so a Session that binds late (or after the page
            // loaded) still contributes its events.
            insufficient: markStore ?? EMPTY_INSUFFICIENT,
            // `available: false` only for an addressed subagent Session, which
            // the shipped seat also hides.
            available: first.addressed !== true,
            directory: first.store,
            load: () => {
              const current = resolve()
              if (current.directory !== undefined) {
                current.directory.load().catch(() => { /* surfaced on the store */ })
              }
            },
            select: selection => {
              const current = resolve()
              return current.directory === undefined
                ? Promise.resolve(undefined)
                : current.directory.select(selection)
            },
            resolveText,
            // Lazy, not snapshotted: the namespace service may still be
            // mounting when this face is built, and the seat is registered
            // once. Re-reading on each use keeps the switch from being frozen
            // out by an early `undefined`.
            teamAvailable: () => readTeamService() !== undefined,
            setTeamMode: enabled => {
              const service = readTeamService()
              return service === undefined
                ? Promise.resolve(undefined)
                : service.setEnabled(sessionId, enabled)
            },
            // Display mode: the ONE page-wide store, read by both this seat's
            // footer button and the composer-row chip that takes over while
            // this seat is disposed.
            displayMode: modeStore,
            setDisplayMode: value => { modeStore.set(value) },
            // Lazy for the same reason as `teamAvailable`: the shipped entry can
            // register AFTER this face is built, and the button has to enable
            // itself without a reload.
            nativeAvailable: canStepAside,
            // The trigger's label: the entry that owns the shipped picker's
            // model-label cell, plus the two seats it needs to render (its own
            // locale namespace and its business inject). Resolved per call so a
            // connection plugin that registers a moment after boot still gets
            // its chip on the trigger without a reload (DEC-030).
            labelEntry: () => readLabelEntry(safeRead('slots')),
            labelSeatFor: namespace => labelSeat(safeRead('locale'), namespace),
            labelFace: entry => {
              if (entry === undefined || typeof entry.inject !== 'function') return {}
              try {
                // The renderer's own contract: a session-scoped entry's inject
                // receives the Session id and is merged UNDER the owner props.
                const face = entry.inject(sessionId)
                return face !== null && typeof face === 'object' ? face : {}
              } catch (error) {
                console.error('dsh-model-flatmap: the label slot face failed to build', error)
                return {}
              }
            },
            // A stable subscribe/getSnapshot pair so the trigger re-reads the
            // winning entry when a connection plugin registers or disposes.
            labelSlot: labelSlotSource(safeRead('slots')),
          }
        }

        /**
         * Call the face builder and never let a throw escape into slot assembly,
         * where it would abdicate the entry and hand the cell back to the native
         * picker. A failed face still renders: the seat reports that it is
         * unavailable instead of disappearing.
         * @param sessionId - the Session this seat renders for.
         * @param build - the face builder.
         * @returns an injected face, degraded when building failed.
         */
        const safeFace = (sessionId, build) => {
          try {
            return build(sessionId)
          } catch (error) {
            console.error('dsh-model-flatmap: the seat face failed to build', error)
            return {
              sessionId,
              available: true,
              directory: undefined,
              resolveDirectory: () => ({ addressed: false, pending: 'seat unavailable' }),
              load: () => {},
              select: () => Promise.resolve(undefined),
              resolveText,
              teamAvailable: () => false,
              setTeamMode: () => Promise.resolve(undefined),
              // A face that failed to build still answers the mark face, so the
              // component's hook shape never changes and the rows simply stay
              // unstruck. It shares the module-level empty snapshot so the
              // identity stays stable across renders.
              insufficient: EMPTY_INSUFFICIENT,
              // Same principle for the mode: a stable flat snapshot and a
              // no-op setter keep the footer's hook shape intact. Stepping aside
              // is refused outright — a face this broken must not hand the
              // composer to anything.
              displayMode: FLAT_DISPLAY_MODE,
              setDisplayMode: () => {},
              nativeAvailable: () => false,
            }
          }
        }

        /**
         * Register the seat, escalating priority when a stale generation still
         * holds the previous entry.
         */
        const registerSeat = () => {
          let lastError
          for (const priority of [-1, -2, -3, -4, -5]) {
            try {
              return slots.register({
                name: 'conversation.input.model',
                priority,
                locale: NS,
                inject: sessionId => safeFace(sessionId, buildFace),
              }, Seat)
            } catch (error) {
              lastError = error
            }
          }
          console.error('dsh-model-flatmap: the model seat was not registered', lastError)
          return () => {}
        }

        // ---- the mode controller
        //
        // Flat mode keeps this plugin's entry registered (it shadows the
        // shipped one at a negative priority). Native mode DISPOSES that entry,
        // which elects the shipped picker underneath. Mount and unmount are
        // therefore the two halves of one switch, and both are idempotent: the
        // notify path re-enters `syncMode` through our own slot mutations.
        let seatDispose
        /** Guard against re-entry from our own registration changes. */
        let syncing = false
        const mountSeat = () => {
          if (seatDispose !== undefined) return
          seatDispose = registerSeat()
        }
        const unmountSeat = () => {
          const dispose = seatDispose
          if (dispose === undefined) return
          seatDispose = undefined
          try {
            dispose()
          } catch (error) {
            console.error('dsh-model-flatmap: the model seat did not dispose cleanly', error)
          }
        }
        /**
         * Reconcile the registration with the store. Native mode only takes
         * effect when another entry can inherit the cell — otherwise the panel
         * stays, so a profile without the shipped picker never loses its model
         * control.
         */
        const syncMode = () => {
          if (syncing) return
          syncing = true
          try {
            const wantsNative = modeStore.getSnapshot() === 'native'
            if (wantsNative && canStepAside()) {
              reportInherit()
              unmountSeat()
            } else {
              mountSeat()
            }
          } finally {
            syncing = false
          }
        }

        try {
          slots.inject('conversation.input.model', () => {
            syncMode()
            const offMode = modeStore.subscribe(syncMode)
            // The shipped entry may register after ours, and a competing entry
            // may unload: both change whether stepping aside is possible, so the
            // button's availability rides the same reconcile.
            const offSlot = typeof slots.subscribe === 'function'
              ? slots.subscribe('conversation.input.model', syncMode)
              : undefined
            return () => {
              if (typeof offMode === 'function') offMode()
              if (typeof offSlot === 'function') offSlot()
              unmountSeat()
            }
          })
        } catch (error) {
          console.error('dsh-model-flatmap: slots.inject failed for the model seat', error)
        }

        // ---- the chip that brings the panel back from native mode
        //
        // Native mode disposes the seat, and with it the footer button that
        // switched. The way back rides the HOST picker's OWN root menu instead:
        // `conversation.input.model.options` is the list child slot the shipped
        // `ModelSelect` declares and renders after its Model / Effort rows, so
        // our row appears at the bottom of the native panel itself. It survives
        // the seat's disposal (it belongs to the shipped entry, not to ours) and
        // renders nothing while the flat panel is the seat on screen.
        try {
          if (typeof slots.inject === 'function') {
            slots.inject('conversation.input.model.options', () => {
              if (typeof slots.register !== 'function') return () => {}
              try {
                return slots.register({
                  name: 'conversation.input.model.options',
                  id: 'dsh-model-flatmap.native',
                  order: 50,
                  locale: NS,
                  inject: () => ({
                    displayMode: modeStore,
                    setDisplayMode: value => { modeStore.set(value) },
                    nativeAvailable: canStepAside,
                  }),
                }, NativeMenuRow)
              } catch (error) {
                console.error('dsh-model-flatmap: the native-mode menu row was not registered', error)
                return () => {}
              }
            })
          }
        } catch (error) {
          // Losing the row costs the way BACK, never the way in: the panel and
          // its footer button still work, and a reload restores flat mode.
          console.error('dsh-model-flatmap: slots.inject failed for the native-mode menu row', error)
        }
      },
    }
  },
})
