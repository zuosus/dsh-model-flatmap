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
/* The same legibility problem, one level out: a row that hosts the shipped
   model-label cell draws ANOTHER PLUGIN'S chips, and those chips are tinted for
   the normal row background — a 16%-alpha brand pill with brand-coloured text
   all but disappears on the selected row's deep blue, where the text is white.
   The occupant cannot know about this band, so the row has to fix it. An
   attribute-substring selector is the only lever over an opaque third-party
   component: a deliberate, documented coupling (DEC-047), not an accident.
   Only the pill SURFACE and the TEXT are touched — never layout, so the
   occupant's own spacing and truncation still hold. */
.dshmf-row[aria-pressed="true"] .dshmf-rowNameWindow [class*="badge"],
.dshmf-row[aria-pressed="true"] .dshmf-rowNameWindow [class*="promo"],
.dshmf-row[aria-pressed="true"] .dshmf-rowNameWindow [class*="Badge"],
.dshmf-row[aria-pressed="true"] .dshmf-rowNameWindow [class*="Promo"] {
  background: color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 22%, transparent) !important;
  color: inherit !important;
  border-color: transparent !important;
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
   The decoration covers the row's text (name + variant tag) and the spinner is
   excluded. A row that hosts the shipped model-label cell is the one case where
   the strike reaches FURTHER than this plugin's own chips: the cell's output is
   opaque, so the line the window draws runs across whatever the occupant put
   there, promotion chip included. That is accepted rather than fixed (DEC-047):
   the alternative is no strike at all on hosted rows, and "this model has no
   balance" is exactly the signal that must not be lost — the chips are
   decoration, the strike is information. */
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
/* The row's own fallback when the picker's render view is hosted but its
   occupant crashed (DEC-046). It replaces the decorated cell with the plain
   catalog name, and it deliberately sets NO type: size, weight and tone are
   inherited from the row, so the fallback reads exactly like a row that never
   hosted a cell — including the selected row's 600 weight, which a hard-coded
   400 here would have silently dropped. Only the box is declared. */
.dshmf-rowLabelFallback { display: inline-block; white-space: nowrap; }
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

/* ---------------------------------------------------------------------------
   Settings section — "Model list".

   Rendered INSIDE the settings panel's scrolling content column, which owns
   padding, scrolling and height. This block therefore only stacks content and
   caps its own width, exactly like the shipped sections: setting a height or an
   overflow here would fight the shell's scroll container.

   Geometry is copied from the shipped settings pages rather than invented: a
   720px cap, 12px between blocks, a 16px/0 row with a 0.5px hairline, and the
   host's own label/border tokens. The switch reproduces the host primitive's
   six rules because that component is a seed word of the module table, not an
   installed package this bundle could depend on.
   --------------------------------------------------------------------------- */
.dshmf-setSection { display: flex; flex-direction: column; gap: 12px; max-width: 720px; color: var(--dsw-alias-label-primary); }
.dshmf-setTitle { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dshmf-setIntro { margin: 0; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-tertiary); }
.dshmf-setEmpty { margin: 0; padding: 16px 0; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-tertiary); }
.dshmf-setNote { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dshmf-setList { display: flex; flex-direction: column; margin-top: 4px; }
.dshmf-setProvider { border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.dshmf-setList > .dshmf-setProvider:last-child { border-bottom: none; }
.dshmf-setProviderRow { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; }
/* The pencil and the switch are one trailing group, so the row's 16px gap
   applies once at the end of the name instead of once around each control. */
.dshmf-setActions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
/* The whole text side of the row is the disclosure, so the button stretches
   from the row's left edge to the switch instead of hugging the chevron. */
.dshmf-setDisclosure {
  display: flex; align-items: center; gap: 10px; flex: 1 1 auto; min-width: 0;
  padding: 2px 0; border: none; border-radius: var(--dsw-radius-xs);
  background: transparent; color: var(--dsw-alias-label-secondary);
  cursor: pointer; text-align: left;
}
@media (hover: hover) { .dshmf-setDisclosure:hover { background: var(--dsw-alias-interactive-bg-hover); } }
.dshmf-setDisclosure:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.dshmf-setChevron { flex: 0 0 auto; transition: transform .12s ease; }
.dshmf-setChevronOpen { transform: rotate(180deg); }
.dshmf-setProviderText { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
/* A provider row is a SECTION HEADER, a model row is an ITEM under it, and the
   two used to be told apart by 1px of size and one label tone — close enough
   that a long list read as one flat column of names.
   The split is made by WEIGHT, in the UI's own face. The provider name stays in
   the inherited font family (the same face every other label in the shell uses)
   and simply carries more weight than a model name; a model name is regular
   400. No second typeface: the brand face (Montserrat) was tried here and read
   badly against the UI face around it, so the family is deliberately left
   alone and the hierarchy is carried by weight, tone and size instead.
   Weight 600 rather than 500 because the inherited UI face ships real 600 and
   700 cuts — unlike the brand face, which only had 300/400/500 — so a genuinely
   bold heading costs nothing and is not browser-synthesised. */
.dshmf-setProviderName {
  display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: inherit;
  font-size: 14px; line-height: 20px; font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dshmf-setProviderMeta {
  display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
}
/* A renamed row keeps its original name on the quiet line: the chosen name is
   the row's identity, but the catalog's spelling must stay recoverable without
   opening an editor. */
.dshmf-setProviderOriginal { color: var(--dsw-alias-label-tertiary); }
/* A switched-off row must stay READABLE: the title drops at most ONE label
   step (primary → secondary) instead of falling to the dimmed placeholder
   tone, which sits below the readable threshold in BOTH themes — the
   installed shell defines it as #e1e5ee on white (light) and #43454a on
   near-black (dark). The user's requirement is "a slightly gray color", not
   a gray-out. The off state is carried by the switch and the dimmed meta
   line, not by an unreadable name. */
.dshmf-setProvider[data-hidden="true"] .dshmf-setProviderName { color: var(--dsw-alias-label-secondary); }
.dshmf-setProvider[data-hidden="true"] .dshmf-setProviderMeta { color: var(--dsw-alias-label-dimmed); }
/* The original name rides the same dimming as the rest of the meta line. */
.dshmf-setProvider[data-hidden="true"] .dshmf-setProviderOriginal { color: var(--dsw-alias-label-dimmed); }
.dshmf-setProviderMeta {
  display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
}
/* A renamed row keeps its original name on the quiet line: the chosen name is
   the row's identity, but the catalog's spelling must stay recoverable without
   opening an editor. */
.dshmf-setProviderOriginal { color: var(--dsw-alias-label-tertiary); }
/* A switched-off provider reads as dimmed, so a long list shows at a glance
   which rows are already out of the panel. */
.dshmf-setProvider[data-hidden="true"] .dshmf-setProviderName,
.dshmf-setProvider[data-hidden="true"] .dshmf-setProviderMeta,
.dshmf-setProvider[data-hidden="true"] .dshmf-setProviderOriginal { color: var(--dsw-alias-label-dimmed); }
/* Rename: a quiet pencil, not a permanent toolbar. It appears when the row is
   hovered or focused, and stays visible on a row that already carries a
   user-chosen name so "this one was renamed" is legible without a badge. The
   tint comes from host tokens only; no accent colour is invented here. */
.dshmf-setRenameBtn {
  display: inline-flex; align-items: center; justify-content: center;
  flex: 0 0 auto; width: 24px; height: 24px; padding: 0;
  border: 0; border-radius: var(--dsw-radius-xs);
  background: transparent; color: var(--dsw-alias-label-caption);
  cursor: pointer; opacity: 0;
  transition: opacity .12s ease, background .12s ease, color .12s ease;
}
@media (hover: hover) {
  .dshmf-setProviderRow:hover .dshmf-setRenameBtn,
  .dshmf-setProviderRow:focus-within .dshmf-setRenameBtn { opacity: 1; }
}
.dshmf-setRenameBtn[data-renamed="true"] { opacity: 1; color: var(--dsw-alias-label-secondary); }
.dshmf-setRenameBtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshmf-setRenameBtn:focus-visible {
  opacity: 1;
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
@media (hover: none) { .dshmf-setRenameBtn { opacity: 1; } }
/* The inline editor. Geometry is copied from the shipped Models page field
   (32 px, a .5 px border-l4, radius-md, bg-layer-1, 14 px) so renaming looks
   like every other editable name in Settings instead of a new control family.
   The ghost chevron keeps the input aligned with the collapsed name; the
   switch stays top-aligned so the row does not jump around it. */
.dshmf-setProviderRow[data-editing="true"] { align-items: flex-start; }
.dshmf-setProviderRow[data-editing="true"] .dshmf-switch { margin-top: 6px; }
.dshmf-setEditorWrap { display: flex; flex-direction: column; gap: 4px; flex: 1 1 auto; min-width: 0; }
.dshmf-setEditor { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dshmf-setEditorChevron { flex: 0 0 auto; margin-right: 4px; color: var(--dsw-alias-label-caption); opacity: .55; }
.dshmf-setField { position: relative; display: block; flex: 1 1 auto; min-width: 0; }
.dshmf-setInput {
  box-sizing: border-box; width: 100%; height: 32px;
  border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 14px; line-height: 22px; padding: 0 34px 0 10px;
}
.dshmf-setInput:focus { border-color: var(--dsw-alias-state-business-primary); outline: none; }
.dshmf-setInput::placeholder { color: var(--dsw-alias-label-dimmed); }
.dshmf-setAliasReset {
  position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: var(--dsw-radius-xs);
  background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer;
}
.dshmf-setAliasReset:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshmf-setAliasReset:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dshmf-setEditBtn {
  display: inline-flex; align-items: center; justify-content: center;
  flex: 0 0 auto; width: 26px; height: 26px; padding: 0;
  border: 0; border-radius: var(--dsw-radius-xs);
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.dshmf-setEditBtn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshmf-setEditBtn:disabled { opacity: .4; cursor: default; }
.dshmf-setEditBtn:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dshmf-setSaveBtn { color: var(--dsw-alias-brand-primary); }
.dshmf-setEditHint { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 0 23px; min-width: 0; position: relative; }
.dshmf-setEditOriginal {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary);
}
.dshmf-setEditKeys { flex: 0 0 auto; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-caption); }
.dshmf-setEditStatus { flex: 0 0 auto; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-warn-primary); }
/* The live region is mounted for the editor's whole life and stays in the
   accessibility tree even while empty — a status node that appears together
   with its text is not announced by most screen readers. It is clipped rather
   than hidden with display:none for exactly that reason. */
.dshmf-setEditStatus:empty {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
}
/* Touch has no Enter/Escape, and the visible buttons say what to do. */
@media (hover: none) { .dshmf-setEditKeys { display: none; } }
@media (prefers-reduced-motion: reduce) { .dshmf-setRenameBtn { transition: none; } }
/* 23px = the chevron's 13px + the disclosure's 10px gap, so a model name sits
   under the provider name it belongs to. */
.dshmf-setModels { display: flex; flex-direction: column; padding: 0 0 8px 23px; }
.dshmf-setModelRow { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 6px 0; }
/* The item face is MONOSPACE, and that is the point: a model name is an
   IDENTIFIER (grok-4, claude-sonnet-5.5, deepseek-v4.1-flash-1017), not
   prose, so it is set in the shell's own code face rather than the UI face.
   Fixed-width also does real work here: version numbers and rate suffixes line
   up between rows, so a column of names can be scanned instead of read.
   The family comes from the host token --ds-font-family-code, which the shell
   already defines (SF Mono / JetBrains Mono / Fira Code / Consolas, with a CJK
   fallback) — never a hard-coded stack, so it follows the shell's own choice.
   Weight stays 400. An ON title carries the PRIMARY tone (near-black in light,
   near-white in dark): a model row you can USE should read at full strength,
   and that is what makes the ON/OFF gap obvious. The provider row above stays
   apart by FACE and WEIGHT (600, UI face, vs this 400 monospace), not by tone —
   the two share the primary tone on purpose. */
.dshmf-setModelName {
  font-family: var(--ds-font-family-code);
  font-size: 13px; line-height: 20px; font-weight: 400;
  color: var(--dsw-alias-label-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* Stated, not inherited: an OFF model title drops to the shell's own
   quiet-prose tone (tertiary, already used for setIntro/setEmpty here) — a
   single clear rung below the primary tone an ON title carries, so ON and OFF
   cannot be confused at a glance yet the OFF name stays readable. Never the
   dimmed placeholder tone — #e1e5ee on white / #43454a on dark measure
   1.26:1 / 1.64:1, below any readable threshold. ON (primary) 18.90:1 /
   15.03:1 vs OFF (tertiary) 2.13:1 / 4.24:1. */
.dshmf-setModelRow[data-hidden="true"] .dshmf-setModelName { color: var(--dsw-alias-label-tertiary); }
/* A model row's text side, mirroring the provider row: the name is the heading
   and the note is the line UNDER it. Needed because a note cannot live inside
   .dshmf-setModelName — that span is one ellipsised line. */
.dshmf-setModelText { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
/* The name and its catalog chip share ONE line; the credit note, when present,
   stays on the line UNDER them. The line — not the chip — is what gives way, so
   the chip keeps its size and the switch keeps its place however long the name.
   The name keeps its own min-width:0 so IT is the span that ellipsises. */
.dshmf-setModelNameLine { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshmf-setModelText .dshmf-setModelName { min-width: 0; }
/* The catalog's own badge chip on a settings model row: the same chip the
   picker's rows draw, so a model is decorated identically on both surfaces. It
   is the catalog's data, not a settings invention — a model the catalog badges
   nothing about draws no chip and keeps no gap for one. */
.dshmf-setModelBadge { flex: none; }
.dshmf-setModelRow[data-hidden="true"] .dshmf-setModelBadge { opacity: .55; }
/* The "no credit" line, on both the provider row and the model rows.
   The PICKER says the same fact with a strike through the row text (see
   .dshmf-row[data-insufficient]); Settings says it in WORDS, because a settings
   row is read as a list of switches rather than as a live status line, and a
   strike here would collide with the tone-stepping that already marks a row as
   switched off — two different states must not share one decoration. The warn
   label token is the shell's own and flips with the theme, so the line stays
   legible on both backgrounds without a second colour being invented here. */
.dshmf-setNoCredit {
  display: block; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-state-warn-label);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* A switched-off row keeps the credit note in the dimmed tone: the same rung
   the meta line takes when hidden (titles step to tertiary, meta dims), so the
   note stays present but stops outshining the fact that the row is off. */
.dshmf-setProvider[data-hidden="true"] .dshmf-setNoCredit,
.dshmf-setModelRow[data-hidden="true"] .dshmf-setNoCredit { color: var(--dsw-alias-label-dimmed); }
/* The telemetry toggle is its own band at the BOTTOM of the section, divided
   from the model list above by the same hairline the list rows use. It governs
   the whole plugin's one network request, so it sits apart from the provider
   and model switches rather than inside the list. */
.dshmf-setTelemetry { margin-top: 4px; padding-top: 12px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dshmf-setTelemetryRow { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 4px 0; }
.dshmf-setTelemetryText { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.dshmf-setTelemetryTitle { display: block; font-size: 14px; line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshmf-setTelemetryDesc { display: block; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dshmf-switch {
  box-sizing: border-box; position: relative; flex: 0 0 auto;
  width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px;
  background: var(--dsw-alias-border-l3); cursor: pointer;
}
.dshmf-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }
/* A bulk switch with only SOME of its models on. It reads as "partly on"
   without a third colour: the track takes the brand fill at reduced weight and
   the thumb parks in the middle, which is the conventional mixed rendering. */
.dshmf-switch[aria-checked="mixed"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l3)); }
.dshmf-switch[aria-checked="mixed"] .dshmf-switchThumb { transform: translate(8px); }
/* A model switch sits UNDER its provider switch. All three provider states stay
   on the brand blue (solid on, pale mixed, grey off), so the child shifts the
   hue towards success instead of adding one more shade of blue: the master
   control and the per-model exceptions never blur in a long expanded list. */
.dshmf-switchModel[aria-checked="true"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 50%, var(--dsw-alias-state-success-primary)); }
.dshmf-switch:disabled { cursor: default; opacity: .45; }
.dshmf-switch:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dshmf-switchThumb {
  display: block; width: 16px; height: 16px; border-radius: 50%;
  background: var(--dsw-alias-label-primary-foreground); transition: transform .12s ease;
}
.dshmf-switch[aria-checked="false"] .dshmf-switchThumb { background: var(--dsw-alias-switch-thumb); }
.dshmf-switch[aria-checked="true"] .dshmf-switchThumb { transform: translate(16px); }

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

/* The trailing PAIR: the project-link icon and the display-mode button.
   It is ONE footer child, and that is what makes the gap between the two
   buttons small. As two separate footer children they were also two flex items
   on the footer's line, so the footer's own column-gap of 30px — the spacing
   that separates the reasoning group from the teamwork row — was applied
   BETWEEN them as well, and no margin on either button could shrink it.
   Grouping them here takes them out of that gap's reach: the 30px now applies
   once, outside the pair, and the space INSIDE is this container's own 2px gap.
   The pair also carries the auto margin, so the two travel together to the
   panel's bottom-right and wrap as one unit on a narrow panel. */
.dshmf-actions {
  flex: 0 0 auto; display: inline-flex; align-items: center;
  gap: 2px; margin-left: auto;
}

/* Display-mode button: the pair's trailing member. Drawn with the panel's own
   segment recipe (toned track, 2px inset, radius-xs) so it reads as the same
   design system as the header grouping control and the reasoning levels, and
   so the pressed state is unmistakable in both themes. It carries no auto
   margin of its own: the PAIR owns the right alignment, which is what keeps it
   beside the icon rather than pinned away from it. */
.dshmf-modeBtn {
  flex: 0 0 auto;
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

/* Project-link button: the pair's leading member, the icon IMMEDIATELY LEFT of
   the display-mode button. The 22px height and radius-xs mirror the mode
   button so the two read as one control group, and the pair's own 2px gap is
   the only space between them. */
.dshmf-linkBtn {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0; border: 0; border-radius: var(--dsw-radius-xs);
  background: transparent; color: var(--dsw-alias-label-secondary);
  cursor: pointer; transition: color 120ms ease, background 120ms ease;
}
@media (hover: hover) { .dshmf-linkBtn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); } }
.dshmf-linkBtn:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.dshmf-linkBtn:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }

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
    if (typeof document !== 'undefined') {
      const selector = `style[data-plugin-css=${JSON.stringify(STYLE_TAG)}]`
      let tag = document.querySelector(selector)
      if (tag === null) {
        tag = document.createElement('style')
        tag.dataset.plugin = STYLE_OWNER
        tag.dataset.pluginCss = STYLE_TAG
        document.head.append(tag)
      }
      // Rewrite the body on every (re)load. HMR re-executes this module while
      // leaving the document untouched, so skipping the write when the tag
      // already exists would keep the browser on the previous revision's CSS
      // until the whole page is reloaded.
      tag.textContent = CSS
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
    /* Two interlocking links, drawn at the panel's own 1.5px stroke weight and
       centred in the 14-unit box (bbox 1.2–12.8). It names the ACTION — leave
       the panel for a web page — rather than the destination's owner, because
       the owner is whatever repository the checkout configures and can change
       without this file. */
    const PATH_LINK = 'M5.833 7.583a2.917 2.917 0 0 0 4.398.315l1.75-1.75a2.917 2.917 0 0 0-4.124-4.124l-1.003.997M8.167 6.417a2.917 2.917 0 0 0-4.398-.315l-1.75 1.75a2.917 2.917 0 0 0 4.124 4.124l.997-.997'
    /* A pencil, not a gear: the row's action is to change the NAME, and a
       settings glyph would read as "configure the provider" — a different
       action with a different meaning (routing, credentials). */
    const PATH_PENCIL = 'M9.6 2.2a1.5 1.5 0 0 1 2.2 2.1L5.2 10.9l-2.9.7.7-2.9 6.6-6.5ZM8.6 3.5l1.9 1.9'
    const PATH_CONFIRM = 'M3.1 7.4 5.8 10.1 11 4.6'
    /* A circular arrow: put the catalog's own name back. */
    const PATH_RESET = 'M3.2 6.2A3.9 3.9 0 1 1 3.4 8.7M3.2 6.2V2.9M3.2 6.2h3.3'

    /**
     * A model's catalog badge, resolved for display, or null.
     *
     * Module-level so the Settings model list can draw the same chip the
     * picker's rows do. The catalog's `badge.text` may be a literal or a
     * translation map, so resolution goes through the host's own resolver; a
     * catalog with no badge, or one whose text resolves to nothing, answers
     * null and the caller draws no chip (and therefore no gap).
     * @param {object|undefined} model - one catalog model entry.
     * @param {Function|undefined} resolveText - the host's catalog-text resolver.
     * @returns {{label: string, tone: string}|null} the chip, or null.
     */
    function catalogBadge(model, resolveText) {
      const badge = model === undefined || model === null ? undefined : model.badge
      if (badge === undefined || badge === null) return null
      const label = resolveText === undefined ? undefined : resolveText(badge.text)
      if (typeof label !== 'string' || label.trim() === '') return null
      return { label, tone: badge.tone ?? 'neutral' }
    }

    /**
     * Split a model name into React children, lifting any "xN" multiplier
     * marker (rate/size tags like "x0.01", "x1.5", "X 2.2") into a smaller,
     * bold span so it reads as an aside while the full name and its order are
     * preserved. Matches an x (any case, or the multiplication sign) that
     * STARTS a token — preceded by start-of-string or a non-word character,
     * so it is not embedded in a word like "GenX5" — followed by optional
     * whitespace and a number (integer or decimal, optional leading +).
     *
     * Module-level so the Settings model list lifts "· x0.01" exactly as the
     * picker's rows do, or one surface shows the rate as plain prose.
     * @param {unknown} rawName - the catalog name.
     * @returns {Array} React children: literal text and marked spans.
     */
    const MULT_MARKER = /(?<![\p{L}\p{N}])[xX×]\s*[+]?\d+(?:\.\d+)?/gu
    function nameRuns(rawName) {
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
     * The user's alias is the last input, not a replacement for the catalog
     * lookup: it wins when present, while an absent or blank alias keeps the
     * catalog's own label (including the localized account name). This is the
     * ONE place a display name is derived, so a renamed provider cannot show
     * two spellings across the picker, Settings and search.
     * @param {{id: string, name: unknown}} group - one provider entry.
     * @param {Function} t - the panel's own translate seat.
     * @param {Function|undefined} resolveText - the host's catalog-text resolver.
     * @param {unknown} [alias] - the user's rename, when one is stored.
     * @returns {string} a display-ready label; never empty.
     */
    function providerLabel(group, t, resolveText, alias) {
      const renamed = sanitizeAlias(alias)
      if (renamed !== '') return renamed
      const name = providerNameFor(group, t)
      const resolved = resolveText === undefined ? undefined : resolveText(name)
      if (typeof resolved === 'string' && resolved.trim() !== '') return resolved
      const fallback = fallbackText(name)
      return fallback.trim() === '' ? group.id : fallback
    }

    /**
     * A provider's catalog name, UNRESOLVED, as the model-label cell wants it.
     *
     * The cell resolves localized catalog text with its own locale seat, so this
     * hands it the raw catalog name — except for the one provider the shipped
     * picker itself localizes, which is spelled out here so the row and the
     * trigger agree with the native menu.
     *
     * Extracted because three call sites need it (the panel's display label,
     * the trigger's owner props, a row's owner props) and three copies of the
     * `deepseek-account` exception would drift apart.
     * @param {{id: string, name: unknown}} group - one provider entry.
     * @param {Function} t - the panel's own translate seat.
     * @returns {unknown} the catalog name, unresolved.
     */
    function providerNameFor(group, t) {
      if (group.id === 'deepseek-account') return t('provider.account')
      return group.name
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
    // Visibility — which providers and models the panel is allowed to draw.
    //
    // A profile with a dozen connection plugins offers far more models than
    // anyone picks between, and the flat panel shows all of them at once. The
    // feature therefore records what the user has SWITCHED OFF, not what they
    // left on, and that choice is made in the Settings panel (see the
    // `settings.section` registration in `apply`).
    //
    // Three properties decide the shape below:
    //
    // 1. **Hidden is stored, visible is implied.** A model added by a plugin
    //    installed tomorrow must appear without anyone re-opening Settings, so
    //    the absence of a record means visible. This also keeps the record
    //    small: the common case stores nothing at all.
    // 2. **The record is keyed by route, like the balance marks.** A provider
    //    may publish the same model id under two groups, and a group may be
    //    renamed; the key is the same `provider/model` pair the strike state
    //    uses, plus a bare provider id for a provider-wide switch. Both live in
    //    ONE record, so a provider switch and a per-model exception can never
    //    disagree about which of them was written last.
    // 3. **Storage failure degrades to "show everything".** The panel's job is
    //    to offer the catalogue; a browser that refuses `localStorage` must
    //    lose the memory of the choice, never the models.
    // ---------------------------------------------------------------------
    const HIDDEN_KEY = 'dshmf:hidden'

    /** The shared empty hidden record; one instance keeps `getSnapshot` stable. */
    const EMPTY_HIDDEN = new Set()

    /**
     * Read one stored hidden record, or an empty set when storage is missing,
     * holds garbage, or throws.
     *
     * The record is a flat object of `key -> true`. Only `true` counts: a
     * `false` is a leftover from a version that stored both states and must
     * never resurrect a hidden model.
     * @returns {Set<string>} the hidden provider ids and `provider/model` routes.
     */
    function readHidden() {
      try {
        if (typeof localStorage === 'undefined') return new Set()
        const text = localStorage.getItem(HIDDEN_KEY)
        if (text === null || text === '') return new Set()
        const parsed = JSON.parse(text)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return new Set()
        const hidden = new Set()
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof key !== 'string' || key === '') continue
          if (value === true) hidden.add(key)
        }
        return hidden
      } catch {
        return new Set()
      }
    }

    /**
     * Persist one hidden record. A write failure is swallowed: the in-memory
     * set still drives every open panel in this page.
     * @param {Set<string>} hidden - the keys to persist.
     */
    function writeHidden(hidden) {
      try {
        if (typeof localStorage === 'undefined') return
        const record = {}
        for (const key of hidden) record[key] = true
        localStorage.setItem(HIDDEN_KEY, JSON.stringify(record))
      } catch {
        /* storage unavailable — keep the in-memory choice only */
      }
    }

    /**
     * The provider-wide key. A provider id can never collide with a route key:
     * routes always contain a `/`, and provider ids do not.
     * @param {unknown} providerId - the provider's id.
     * @returns {string} the key that hides a whole provider.
     */
    function providerHiddenKey(providerId) {
      return String(providerId ?? '')
    }

    /**
     * The per-model key, identical to the balance marks' route key so the two
     * features agree about what "one model" means.
     * @param {unknown} providerId - the provider's id.
     * @param {unknown} modelId - the provider-owned model id.
     * @returns {string} the key that hides one model.
     */
    function modelHiddenKey(providerId, modelId) {
      return routeKeyOf(providerId, modelId)
    }

    /**
     * Is one model currently allowed on screen?
     *
     * The provider switch is NOT an override: it is a bulk action that writes
     * every model's own key (see {@link groupVisibility} and
     * {@link hiddenKeysForGroup}). A model is therefore hidden only because its
     * OWN key says so, which is what lets the user switch a provider off and
     * then switch a few of its models back on.
     *
     * A provider-wide key is still honoured as a fallback, for a record written
     * by the previous design (which stored `provider -> true` and treated it as
     * an override). Without that, an existing record would silently stop
     * hiding anything. The settings page migrates such a record to per-model
     * keys the first time it sees the provider's catalogue.
     * @param {Set<string>} hidden - the hidden record.
     * @param {unknown} providerId - the provider's id.
     * @param {unknown} modelId - the model's id.
     * @returns {boolean} whether the model should be drawn.
     */
    function modelIsVisible(hidden, providerId, modelId) {
      if (hidden.has(modelHiddenKey(providerId, modelId))) return false
      return !hidden.has(providerHiddenKey(providerId))
    }

    /**
     * Every key that switches one provider's models on or off.
     *
     * Includes the legacy provider-wide key so a bulk action CLEARS it: while
     * that key is present it hides the whole provider regardless of the
     * per-model keys, and a "show these three models" action would otherwise
     * appear to do nothing.
     * @param {{id: string, models: Array<object>}} group - one provider.
     * @returns {string[]} the keys a bulk write must set or clear.
     */
    function hiddenKeysForGroup(group) {
      const keys = [providerHiddenKey(group.id)]
      for (const model of group.models) keys.push(modelHiddenKey(group.id, model.id))
      return keys
    }

    /**
     * How one provider reads at a glance.
     *
     * The provider switch has no state of its own any more; it reports its
     * models and acts on them. `allVisible` is what the switch is drawn
     * checked from, and `mixed` is the state that tells the user "this
     * provider is partly on" — the situation the bulk action exists to create.
     * @param {Set<string>} hidden - the hidden record.
     * @param {{id: string, models: Array<object>}} group - one provider.
     * @returns {{total: number, hidden: number, visible: number, allVisible: boolean, allHidden: boolean, mixed: boolean}}
     */
    function groupVisibility(hidden, group) {
      const total = group.models.length
      let visible = 0
      for (const model of group.models) {
        if (modelIsVisible(hidden, group.id, model.id)) visible += 1
      }
      return {
        total,
        visible,
        hidden: total - visible,
        allVisible: total > 0 && visible === total,
        allHidden: visible === 0,
        mixed: visible > 0 && visible < total,
      }
    }

    /**
     * Do two records hold the same keys?
     * @param {Set<string>} left - one record.
     * @param {Set<string>} right - the other.
     * @returns {boolean} whether they are equal.
     */
    function sameKeys(left, right) {
      if (left.size !== right.size) return false
      for (const key of left) if (!right.has(key)) return false
      return true
    }

    /**
     * The record after switching one provider's models on or off.
     *
     * Pure, so the semantics can be pinned without a store or a browser: every
     * model in the group is written to its own key, and the legacy provider key
     * is dropped. Switching a provider off therefore produces the SAME record
     * the user could have produced one model at a time, which is why a later
     * per-model switch composes with it instead of fighting it.
     * @param {Set<string>} hidden - the current record.
     * @param {{id: string, models: Array<object>}} group - the provider.
     * @param {boolean} visible - `false` hides every model in the group.
     * @returns {Set<string>} the new record (the input is never mutated).
     */
    function setGroupVisible(hidden, group, visible) {
      const next = new Set(hidden)
      next.delete(providerHiddenKey(group.id))
      for (const model of group.models) {
        const key = modelHiddenKey(group.id, model.id)
        if (visible) next.delete(key)
        else next.add(key)
      }
      return next
    }

    /**
     * Filter a catalogue down to what the panel may draw.
     *
     * Providers that end up with no visible model are DROPPED rather than
     * rendered as an empty heading — the panel already drops search-emptied
     * groups, and an empty band would read as a broken provider.
     * @param {Array<{id: string, models: Array<object>}>} groups - catalogue groups.
     * @param {Set<string>} hidden - the hidden record.
     * @returns {Array<object>} the surviving groups, each with its visible models.
     */
    function visibleGroups(groups, hidden) {
      if (hidden === undefined || hidden.size === 0) return groups
      const out = []
      for (const group of groups) {
        const models = group.models.filter(model => modelIsVisible(hidden, group.id, model.id))
        if (models.length === 0) continue
        out.push(models.length === group.models.length ? group : { ...group, models })
      }
      return out
    }

    /**
     * Rewrite a legacy record so it can be edited per model.
     *
     * The previous design stored a bare provider id and treated it as an
     * OVERRIDE. Now that the provider switch is a bulk action, such a key is
     * not something the UI can produce any more — and worse, it would hide the
     * provider's models while the model switches showed them as on and could
     * not turn them off. Folding it into per-model keys makes the record mean
     * exactly what the switches show.
     *
     * A provider key whose provider is not in the catalogue is LEFT ALONE: it
     * may belong to a provider this Host no longer lists, and guessing which
     * models it covered would be worse than keeping it inert.
     * @param {Set<string>} hidden - the current record.
     * @param {Array<{id: string, models: Array<object>}>} groups - the catalogue.
     * @returns {Set<string>} the migrated record, or the input when nothing changed.
     */
    function migrateLegacyHidden(hidden, groups) {
      if (hidden.size === 0) return hidden
      let next = hidden
      for (const group of groups) {
        if (!next.has(providerHiddenKey(group.id))) continue
        if (next === hidden) next = new Set(hidden)
        next.delete(providerHiddenKey(group.id))
        for (const model of group.models) next.add(modelHiddenKey(group.id, model.id))
      }
      return next
    }

    /**
     * The ONE visibility store per plugin generation, shared by the Settings
     * page that writes it and every panel that reads it. Both live in the same
     * page, so a switch flipped in Settings re-renders an open panel without a
     * reload.
     * @param deps - storage accessors, injected for testability.
     * @returns the store plus an idempotent `setVisible`.
     */
    function createHiddenStore(deps) {
      let hidden = new Set(typeof deps.readStored === 'function' ? deps.readStored() : [])
      const listeners = new Set()
      const persist = () => {
        try {
          if (typeof deps.writeStored === 'function') deps.writeStored(hidden)
        } catch {
          /* storage unavailable — the in-memory value still applies */
        }
      }
      /** Publish one new record: persist, then notify every surface. */
      const commit = next => {
        hidden = next
        persist()
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch {
            /* one bad subscriber must not starve the others */
          }
        }
      }
      return {
        getSnapshot: () => hidden,
        subscribe: listener => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        /**
         * Show or hide one key.
         * @param {string} key - a `provider/model` route, or a provider id.
         * @param {boolean} visible - `false` to hide it.
         */
        setVisible: (key, visible) => {
          if (visible === !hidden.has(key)) return
          const next = new Set(hidden)
          if (visible) next.delete(key)
          else next.add(key)
          commit(next)
        },
        /**
         * Switch every model of one provider at once.
         *
         * This is what the provider row's switch does: it writes the same
         * per-model keys the user could have written one at a time, so the two
         * controls compose — switch a provider off, then switch one model back
         * on, and the result is a normal record with no special case in it.
         * @param {{id: string, models: Array<object>}} group - the provider.
         * @param {boolean} visible - `false` hides every model in the group.
         */
        setGroupVisible: (group, visible) => {
          const next = setGroupVisible(hidden, group, visible)
          if (sameKeys(next, hidden)) return
          commit(next)
        },
        /**
         * Fold a record written by the previous design into per-model keys.
         * Idempotent: once migrated, a second call changes nothing.
         * @param {Array<{id: string, models: Array<object>}>} groups - the catalogue.
         */
        migrateLegacy: groups => {
          const next = migrateLegacyHidden(hidden, groups)
          if (next === hidden || sameKeys(next, hidden)) return
          commit(next)
        },
        /** Drop every subscriber (activation teardown). */
        dispose: () => { listeners.clear() },
      }
    }

    /**
     * Frozen stand-in for a screen with no store (a degraded activation, or a
     * test double): everything visible, nothing settable.
     */
    const ALL_VISIBLE = {
      getSnapshot: () => EMPTY_HIDDEN,
      subscribe: () => () => {},
      setVisible: () => {},
      setGroupVisible: () => {},
      migrateLegacy: () => {},
    }

    // ---------------------------------------------------------------------
    // Telemetry toggle (DEC-035).
    //
    // The daily heartbeat is anonymous and rate-bound, but it IS a network
    // request this plugin makes on its own, so the user gets a real switch for
    // it in Settings. It defaults to ON — the collection is opt-out, so a
    // machine whose owner never opens Settings keeps reporting exactly as
    // before, and the toggle is a genuine choice rather than a disguised
    // default.
    //
    // The choice lives in the BROWSER (`localStorage`), but the heartbeat sends
    // from the HOST. The two halves are bridged exactly the way the project
    // link is: the browser mirrors its choice to a Host route, which persists it
    // to a file the Host re-reads before every send. So one switch, one source
    // of truth on each side, and no restart needed.
    // ---------------------------------------------------------------------
    const TELEMETRY_KEY = 'dshmf:telemetry'

    /**
     * The Host route the choice is mirrored to. Document-relative, like every
     * other app-owned route this half fetches; the Host registers the same
     * path with a leading slash. Kept in step by a test (see repo-url's).
     */
    const TELEMETRY_SETTINGS_PATH = 'dsh-model-flatmap/telemetry-settings'

    /**
     * Read the stored telemetry choice, or **true** when storage is missing,
     * holds garbage, or throws. Defaulting to true is the whole point: the
     * collection is opt-out, so an unreadable record must never silently turn
     * reporting off for machines whose owner never touched the switch.
     * @returns {boolean} whether reporting is enabled.
     */
    function readTelemetryEnabled() {
      try {
        if (typeof localStorage === 'undefined') return true
        const text = localStorage.getItem(TELEMETRY_KEY)
        if (text === null || text === '') return true
        const parsed = JSON.parse(text)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return true
        return parsed.enabled !== false
      } catch {
        return true
      }
    }

    /**
     * Persist the telemetry choice. A write failure is swallowed: the in-memory
     * value still drives the toggle and the mirrored Host record.
     * @param {boolean} enabled - the choice to persist.
     */
    function writeTelemetryEnabled(enabled) {
      try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(TELEMETRY_KEY, JSON.stringify({ enabled: enabled !== false }))
      } catch {
        /* storage unavailable — keep the in-memory choice only */
      }
    }

    /**
     * Mirror the telemetry choice to the Host.
     *
     * Every failure resolves rather than rejects: an unreachable route (a build
     * with no Host half, the Desktop app serving its own files) means the
     * browser keeps its `localStorage` choice and the Host keeps its own file —
     * the toggle must never look broken because a mirror did not land.
     *
     * @param {boolean} enabled - the choice to mirror.
     * @param {Function} [fetchImpl] - fetch override, for tests.
     * @returns {Promise<boolean>} whether the Host acknowledged the write.
     */
    async function syncTelemetryEnabled(enabled, fetchImpl) {
      const doFetch = typeof fetchImpl === 'function'
        ? fetchImpl
        : (typeof fetch === 'function' ? fetch : undefined)
      if (doFetch === undefined) return false
      try {
        const response = await doFetch(TELEMETRY_SETTINGS_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: enabled !== false }),
          credentials: 'same-origin',
          cache: 'no-store',
        })
        return Boolean(response?.ok)
      } catch {
        return false
      }
    }

    /**
     * The ONE telemetry store per plugin generation, shared by the Settings
     * toggle that writes it and the mirror that reads it. Mirrors the hidden
     * store's shape so the section treats both faces the same way.
     * @param deps - storage accessors + an optional host mirror, injected for tests.
     * @returns the store with an idempotent `setEnabled`.
     */
    function createTelemetryStore(deps) {
      let enabled = typeof deps.readStored === 'function' ? deps.readStored() : true
      const listeners = new Set()
      const notify = () => {
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch {
            /* one bad subscriber must not starve the others */
          }
        }
      }
      return {
        getSnapshot: () => enabled,
        subscribe: listener => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        /**
         * Set the telemetry choice, persist it locally and mirror it to the Host.
         * The mirror is fire-and-forget: a slow or absent route must not block
         * the toggle's own re-render.
         * @param {boolean} next - the new choice.
         */
        setEnabled: next => {
          const value = next !== false
          if (value === enabled) return
          enabled = value
          try {
            if (typeof deps.writeStored === 'function') deps.writeStored(value)
          } catch {
            /* storage unavailable — the in-memory value still applies */
          }
          if (typeof deps.sync === 'function') {
            try { void Promise.resolve(deps.sync(value)).catch(() => {}) } catch { /* never throws */ }
          }
          notify()
        },
        /** Push the current choice to the Host without changing it. */
        syncNow: () => (typeof deps.sync === 'function' ? deps.sync(enabled) : Promise.resolve(false)),
        /** Drop every subscriber (activation teardown). */
        dispose: () => { listeners.clear() },
      }
    }

    /** Frozen stand-in for a screen with no store (a degraded activation). */
    const TELEMETRY_ON = {
      getSnapshot: () => true,
      subscribe: () => () => {},
      setEnabled: () => {},
      syncNow: () => Promise.resolve(false),
    }

    // ---------------------------------------------------------------------
    // Provider names the user has chosen.
    //
    // A catalog's provider name is authored by the connection plugin and is not
    // a preference this picker can rewrite: the Host's model catalog carries
    // `provider.name` from the adapter, so the name on screen has to be a local
    // alias applied at the ONE place a label is derived.
    //
    // Three properties decide the shape below:
    //
    // 1. **The id is the identity, the alias is only a label.** Keys are
    //    provider ids, never names, so a rename cannot move a model between
    //    providers, change a route key, or make visibility marks disagree.
    // 2. **Absence means the catalog's name.** Removing an alias must restore
    //    the upstream label — including a name the plugin adds later — and an
    //    alias equal to the current label is stored as absence, not as a copy
    //    that would freeze the old spelling.
    // 3. **Storage failure degrades to the catalog name.** Like the hidden
    //    record, a browser that refuses storage loses the alias, never a model.
    // ---------------------------------------------------------------------
    const ALIAS_KEY = 'dshmf:aliases'

    /**
     * Longest accepted alias, in Unicode code points.
     *
     * A provider heading occupies a narrow grid column and marquees only on
     * hover, so a paragraph there would be a tooltip with extra steps. 48 is
     * generous for a name and still leaves the row readable.
     */
    const ALIAS_MAX = 48

    /** The shared empty alias record; one instance keeps `getSnapshot` stable. */
    const EMPTY_ALIASES = new Map()

    /**
     * Normalize one user-authored provider name.
     *
     * Control characters become spaces, every whitespace run becomes one space,
     * and the result is trimmed and capped by CODE POINT rather than by UTF-16
     * unit so an emoji or a CJK extension character is never split in half.
     * @param {unknown} value - the raw input.
     * @returns {string} a display-safe alias, or '' when nothing remains.
     */
    function sanitizeAlias(value) {
      if (typeof value !== 'string') return ''
      const withoutControls = value.replace(/[\u0000-\u001F\u007F]/gu, ' ')
      const collapsed = withoutControls.replace(/\s+/gu, ' ').trim()
      if (collapsed === '') return ''
      return [...collapsed].slice(0, ALIAS_MAX).join('')
    }

    /**
     * The alias to STORE for one draft, or `undefined` to store nothing.
     *
     * Clear, whitespace-only and equal-to-original drafts all mean "use the
     * catalog's name". Comparing against the resolved original here — rather
     * than in the component — keeps the rule identical for the editor, the
     * tests, and any future surface that renames a provider.
     * @param {unknown} value - the draft.
     * @param {unknown} original - the label the catalog currently provides.
     * @returns {string|undefined} the alias to keep, or `undefined` for none.
     */
    function aliasFor(value, original) {
      const next = sanitizeAlias(value)
      if (next === '') return undefined
      const baseline = sanitizeAlias(original)
      if (baseline !== '' && next === baseline) return undefined
      return next
    }

    /**
     * Read the stored aliases, or an empty map when storage is missing, holds
     * garbage, or throws. Only non-empty string values survive sanitization.
     * @returns {Map<string, string>} provider id -> alias.
     */
    function readAliases() {
      try {
        if (typeof localStorage === 'undefined') return new Map()
        const text = localStorage.getItem(ALIAS_KEY)
        if (text === null || text === '') return new Map()
        const parsed = JSON.parse(text)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map()
        const aliases = new Map()
        for (const [key, value] of Object.entries(parsed)) {
          const id = String(key)
          if (id === '') continue
          const alias = sanitizeAlias(value)
          if (alias !== '') aliases.set(id, alias)
        }
        return aliases
      } catch {
        return new Map()
      }
    }

    /**
     * Persist the alias record. A write failure is swallowed: the in-memory map
     * still drives every open panel in this page.
     * @param {Map<string, string>} aliases - provider id -> alias.
     */
    function writeAliases(aliases) {
      try {
        if (typeof localStorage === 'undefined') return
        const record = {}
        for (const [id, value] of aliases) {
          const alias = sanitizeAlias(value)
          if (alias !== '') record[String(id)] = alias
        }
        localStorage.setItem(ALIAS_KEY, JSON.stringify(record))
      } catch {
        /* storage unavailable — keep the in-memory names only */
      }
    }

    /**
     * The alias for one provider, or `undefined` when it still uses its
     * catalog name. Tolerates an absent face so call sites stay simple.
     * @param {Map<string, string>|undefined} aliases - the current record.
     * @param {unknown} providerId - the provider's stable id.
     * @returns {string|undefined} the stored alias.
     */
    function aliasOf(aliases, providerId) {
      if (aliases === undefined || aliases === null || typeof aliases.get !== 'function') return undefined
      const value = aliases.get(String(providerId ?? ''))
      return typeof value === 'string' && value !== '' ? value : undefined
    }

    /**
     * The ONE rename store per plugin generation, shared by the Settings page
     * that writes it and every panel that reads it, so a save in Settings
     * re-renders an open picker with no reload.
     * @param deps - storage accessors, injected for testability.
     * @returns the store plus an idempotent `setAlias`.
     */
    function createAliasStore(deps) {
      let aliases = new Map(typeof deps.readStored === 'function' ? deps.readStored() : [])
      const listeners = new Set()
      const persist = () => {
        try {
          if (typeof deps.writeStored === 'function') deps.writeStored(aliases)
        } catch {
          /* storage unavailable — the in-memory value still applies */
        }
      }
      /** Publish one new record: persist, then notify every surface. */
      const commit = next => {
        aliases = next
        persist()
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch {
            /* one bad subscriber must not starve the others */
          }
        }
      }
      return {
        getSnapshot: () => aliases,
        subscribe: listener => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        /**
         * Rename one provider, or restore its catalog name.
         * @param {unknown} providerId - the provider's stable id.
         * @param {unknown} value - the new name; blank restores the catalog's.
         */
        setAlias: (providerId, value) => {
          const id = String(providerId ?? '')
          if (id === '') return
          const next = sanitizeAlias(value)
          const current = aliases.get(id)
          if (next === '') {
            if (current === undefined) return
            const map = new Map(aliases)
            map.delete(id)
            commit(map)
            return
          }
          if (current === next) return
          const map = new Map(aliases)
          map.set(id, next)
          commit(map)
        },
        /** Drop every subscriber (activation teardown). */
        dispose: () => { listeners.clear() },
      }
    }

    /**
     * Frozen stand-in for a screen with no store (a degraded activation, or a
     * test double): every provider keeps its catalog name.
     */
    const NO_ALIASES = {
      getSnapshot: () => EMPTY_ALIASES,
      subscribe: () => () => {},
      setAlias: () => {},
    }

    // ---------------------------------------------------------------------
    // Project link: the icon button beside the display-mode button.
    //
    // The browser cannot read the checkout — no filesystem, no subprocess — so
    // the Host answers ONE read-only route with the repository's page URL (see
    // `repo-url.js`). This half only fetches that route and opens the result.
    //
    // Two properties matter more than the fetch itself:
    //
    // 1. **The click never waits on the network.** The URL is prefetched when
    //    the panel opens, so the usual click has an answer in hand and opens
    //    the tab synchronously — a `window.open` after an `await` is a popup
    //    the browser is entitled to block. Only a click that arrives before the
    //    prefetch finished takes the async path, and that path is still allowed
    //    to fail visibly rather than doing nothing.
    // 2. **The address is never hardcoded here.** The Host resolves it from the
    //    configured remote, so a fork, a rename or a different owner changes
    //    the destination without touching this file. The constant below is the
    //    Host's documented fallback, repeated only so a build whose route is
    //    unreachable still has somewhere to go.
    // ---------------------------------------------------------------------
    const PROJECT_LINK_PATH = 'dsh-model-flatmap/project-link'
    const PROJECT_LINK_FALLBACK = 'https://github.com/zuosus/dsh-model-flatmap'
    /**
     * How long the prefetch may take before the button settles for the
     * fallback. Short on purpose: a click must open a tab promptly, and this
     * route answers from local disk with no network hop of its own.
     */
    const PROJECT_LINK_TIMEOUT_MS = 4_000

    /**
     * Ask the Host for the project page URL.
     *
     * Every failure — an unreachable route, a non-JSON body, a malformed
     * payload, a timeout, a build with no Host half at all — resolves to the
     * fallback instead of rejecting. The button's job is to have somewhere to
     * go, so "could not resolve" must never mean "does nothing".
     *
     * @param {Function} [fetchImpl] - fetch override, for tests.
     * @returns {Promise<{url: string, source: string}>} the URL and its origin.
     */
    async function fetchProjectLink(fetchImpl) {
      const doFetch = typeof fetchImpl === 'function'
        ? fetchImpl
        : (typeof fetch === 'function' ? fetch : undefined)
      if (doFetch === undefined) return { url: PROJECT_LINK_FALLBACK, source: 'fallback' }
      const controller = typeof AbortController === 'function' ? new AbortController() : undefined
      const timer = controller === undefined ? undefined : setTimeout(() => { controller.abort() }, PROJECT_LINK_TIMEOUT_MS)
      try {
        const response = await doFetch(PROJECT_LINK_PATH, {
          method: 'GET',
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
          ...controller === undefined ? {} : { signal: controller.signal },
        })
        if (response === undefined || response === null || response.ok !== true) {
          return { url: PROJECT_LINK_FALLBACK, source: 'fallback' }
        }
        const payload = await response.json()
        const url = payload !== null && typeof payload === 'object' ? payload.url : undefined
        // Only an http(s) address is ever opened: a payload naming another
        // scheme (a `javascript:` URL, a `file:` path) is not a web page and
        // must not reach `window.open`.
        if (typeof url !== 'string' || !/^https?:\/\//iu.test(url)) {
          return { url: PROJECT_LINK_FALLBACK, source: 'fallback' }
        }
        const source = payload.source === 'remote' ? 'remote' : 'fallback'
        return { url, source }
      } catch {
        return { url: PROJECT_LINK_FALLBACK, source: 'fallback' }
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }

    /**
     * Open one URL in a new tab, without handing the opener a handle on this
     * page. A blocked popup returns `null`, which the caller reports instead of
     * silently pretending the tab opened.
     *
     * @param {string} url - an http(s) address.
     * @returns {boolean} whether a tab was requested.
     */
    function openInNewTab(url) {
      try {
        if (typeof window === 'undefined' || typeof window.open !== 'function') return false
        const opened = window.open(url, '_blank', 'noopener,noreferrer')
        return opened !== null && opened !== undefined
      } catch {
        return false
      }
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
        'empty.hidden': '所有模型已在设置中隐藏。可在「设置 → 模型列表」中重新开启。',
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
        'link.label': '网页链接',
        'link.open': '在新标签页打开项目网页',
        'link.openFrom': '在新标签页打开项目网页：{url}',
        'link.fallback': '未找到可用的 GitHub 远程地址，打开本项目主页',
        'link.failed': '浏览器阻止了新标签页，请允许弹出窗口后重试',
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
        'empty.hidden': 'Every model is hidden in Settings. Re-enable them under Settings → Model list.',
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
        'link.label': 'Web page',
        'link.open': 'Open the project web page in a new tab',
        'link.openFrom': 'Open the project web page in a new tab: {url}',
        'link.fallback': 'No usable GitHub remote was found; open this project\'s home page',
        'link.failed': 'The browser blocked the new tab. Allow pop-ups and try again.',
      },
    }

    // ---------------------------------------------------------------------
    // Settings-section copy — its OWN locale namespace.
    //
    // The panel's dictionary above is registered under the panel's per-module
    // `NS`, which is deliberately re-minted for every module generation so an
    // enable/disable/enable cycle cannot collide with a namespace the locale
    // registry still holds. The Settings section needs a STABLE namespace
    // instead: its nav label is a thunk the settings shell re-reads on every
    // projection and on every locale revision, and the section outlives any one
    // generation. It therefore registers under its own fixed id, and a
    // re-registration after a reload is safe because the registry drops the
    // previous generation's entry with its own disposer.
    // ---------------------------------------------------------------------
    // Minted per generation for the same reason as the panel's `NS`: the locale
    // registry keeps a namespace's slot after its disposer runs, and
    // re-registering the same id throws — which would cost the section its copy
    // on the enable/disable/enable path. A stable id is NOT needed: the settings
    // shell re-reads the label thunk from the live registration, not from a
    // namespace name it remembers.
    const SETTINGS_NS = `modelFlatmapSettings-${Math.random().toString(36).slice(2, 10)}`
    const settingsDict = {
      zh: {
        nav: '模型列表',
        title: '模型列表',
        // The account provider has no catalog name of its own; `providerLabel`
        // asks this namespace for it, exactly as the panel's own dictionary
        // does. Without it the row would print the raw key.
        'provider.account': 'DeepSeek 账号',
        intro: '选择在平铺模型面板中显示哪些 Provider 和模型。隐藏的项不会出现在面板里，也不会出现在搜索结果中。点击 Provider 名称旁的铅笔图标，可以给它换一个显示名称。',
        empty: '模型目录尚未加载。打开一次模型面板后再回来查看。',
        models: '{count} 个模型',
        visibleCount: '{count} 个已开启',
        allOff: '全部关闭',
        expand: '展开',
        collapse: '收起',
        providerToggle: '显示 {name}',
        modelToggle: '显示 {name}',
        'alias.editLabel': '重命名 {name}',
        'alias.renamedLabel': '重命名 {name}，原名 {original}',
        'alias.field': '显示名称，原名 {original}',
        'alias.original': '原名 {original}',
        'alias.keyboard': 'Enter 保存 · Esc 取消',
        'alias.save': '保存名称',
        'alias.cancel': '取消重命名',
        'alias.reset': '恢复原名 {original}',
        'alias.duplicate': '另一个 Provider 使用了这个名称',
        // The balance verdict, said in words rather than with a strike: see
        // `.dshmf-setNoCredit`. `allNoCredit` is the same fact one level up, for
        // a provider whose every model is out.
        noCredit: '无额度',
        allNoCredit: '全部模型无额度',
        noCreditHint: '该模型最近一次调用因余额/额度不足而失败（含以 429 返回的额度不足）。任何一次正常响应的调用都会清除它；连续 24 小时没有再调用也会自动消失。',
        note: '新增的 Provider 和模型默认显示。',
        'telemetry.title': '匿名使用统计',
        'telemetry.desc': '每天最多一次，仅上报安装标识、插件版本、平台与架构，不含任何会话内容。默认开启。',
        'telemetry.toggle': '匿名使用统计',
      },
      en: {
        nav: 'Model list',
        title: 'Model list',
        'provider.account': 'DeepSeek Account',
        intro: 'Choose which providers and models appear in the flat model panel. Hidden entries are left out of the panel and of search results. Use the pencil beside a provider name to give it a different display name.',
        empty: 'The model catalogue has not loaded yet. Open the model panel once, then come back.',
        models: '{count} models',
        visibleCount: '{count} on',
        allOff: 'all off',
        expand: 'Expand',
        collapse: 'Collapse',
        providerToggle: 'Show {name}',
        modelToggle: 'Show {name}',
        'alias.editLabel': 'Rename {name}',
        'alias.renamedLabel': 'Rename {name}, originally {original}',
        'alias.field': 'Display name, originally {original}',
        'alias.original': 'Original: {original}',
        'alias.keyboard': 'Enter to save · Esc to cancel',
        'alias.save': 'Save name',
        'alias.cancel': 'Cancel rename',
        'alias.reset': 'Restore {original}',
        'alias.duplicate': 'Another provider already uses this name',
        noCredit: 'No credit',
        allNoCredit: 'all models out of credit',
        noCreditHint: 'Its most recent call failed on an insufficient balance, credit or quota — including a 429 that says so. Any call that answers clears it, as does 24h without another attempt.',
        note: 'Newly added providers and models are shown by default.',
        'telemetry.title': 'Anonymous usage statistics',
        'telemetry.desc': 'At most once a day: install id, plugin version, platform and architecture only — never any session content. On by default.',
        'telemetry.toggle': 'Anonymous usage statistics',
      },
    }

    const SETTINGS_NAV_LABELS = new Set([settingsDict.zh.nav, settingsDict.en.nav])

    function createSettingsListIcon(doc) {
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 16 16')
      svg.setAttribute('width', '16')
      svg.setAttribute('height', '16')
      svg.setAttribute('fill', 'none')
      svg.setAttribute('aria-hidden', 'true')
      svg.setAttribute('focusable', 'false')
      svg.setAttribute('data-dshmf-settings-list', '1')
      const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', 'M6 4h7M6 8h7M6 12h7M2.5 4h.01M2.5 8h.01M2.5 12h.01')
      path.setAttribute('stroke', 'currentColor')
      path.setAttribute('stroke-width', '1.4')
      path.setAttribute('stroke-linecap', 'round')
      svg.appendChild(path)
      return svg
    }

    function installSettingsNavIcon(doc, Observer = globalThis.MutationObserver) {
      if (doc?.body === undefined || doc.body === null) return () => {}

      const replaceIcon = button => {
        if (typeof button?.textContent !== 'string' || !SETTINGS_NAV_LABELS.has(button.textContent.trim())) return
        const icon = button.querySelector?.('svg')
        if (icon === null || icon === undefined || icon.getAttribute('data-dshmf-settings-list') === '1') return
        if (icon.parentNode !== null && icon.parentNode !== undefined) {
          icon.parentNode.replaceChild(createSettingsListIcon(doc), icon)
        }
      }

      const inspect = root => {
        if (root === null || root === undefined || root.nodeType !== 1) return
        if (typeof root.matches === 'function' && root.matches('button')) replaceIcon(root)
        if (typeof root.closest === 'function') replaceIcon(root.closest('button'))
        if (typeof root.querySelectorAll === 'function') {
          for (const button of root.querySelectorAll('button')) replaceIcon(button)
        }
      }

      inspect(doc.body)
      if (typeof Observer !== 'function') return () => {}

      const observer = new Observer(records => {
        for (const record of records) {
          const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement
          if (target !== null && target !== undefined && typeof target.closest === 'function') {
            replaceIcon(target.closest('button'))
          }
          for (const node of record.addedNodes ?? []) inspect(node)
        }
      })
      observer.observe(doc.body, { childList: true, subtree: true })
      return () => observer.disconnect()
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
     * The list child slot the native picker declares for its trailing rows.
     *
     * `NativeMenuRow` registers here so the way BACK from native mode lives
     * inside the host's own panel. It is a child of the model seat, which means
     * only the ELECTED seat's registration can declare it — so this constant is
     * also how the seat proves that the entry underneath it is a real native
     * picker rather than another plugin's replacement control.
     */
    const NATIVE_MENU_SLOT = 'conversation.input.model.options'

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
        insufficient, displayMode, setDisplayMode, nativeAvailable, visibility,
        aliases,
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

      // Which providers and models Settings has switched off. Same page-wide
      // store the Settings section writes, so a toggle flipped there re-renders
      // an open panel immediately. `hidden` is a Set, and the store keeps its
      // identity until a key actually changes, so this cannot loop.
      const visibleFace = visibility ?? ALL_VISIBLE
      const subscribeVisible = useCallback(listener => visibleFace.subscribe(listener), [visibleFace])
      const getHidden = useCallback(() => visibleFace.getSnapshot(), [visibleFace])
      const hidden = useSyncExternalStore(subscribeVisible, getHidden, getHidden)

      // The names the user chose in Settings, from the SAME page-wide store the
      // Settings editor writes. The map keeps its identity until a name really
      // changes, so this subscription cannot loop.
      const aliasFace = aliases ?? NO_ALIASES
      const subscribeAliases = useCallback(listener => aliasFace.subscribe(listener), [aliasFace])
      const getAliases = useCallback(() => aliasFace.getSnapshot(), [aliasFace])
      const providerAliases = useSyncExternalStore(subscribeAliases, getAliases, getAliases)
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

      /**
       * Open the project page in a new tab.
       *
       * The prefetched URL is used synchronously when it is already in hand,
       * which is the ordinary case and the only one that reliably survives a
       * popup blocker. Before it lands, the same fetch is awaited once and then
       * opened; if the browser still refuses, the button says so rather than
       * looking dead.
       *
       * @returns {void}
       */
      const openProjectLink = () => {
        const launch = url => {
          if (openInNewTab(url)) setLinkFailure(false)
          else setLinkFailure(true)
        }
        if (projectLink !== null) {
          launch(projectLink.url)
          return
        }
        // Not prefetched yet (or the prefetch failed): resolve once, then open.
        fetchProjectLink().then(result => {
          setProjectLink(result)
          launch(result.url)
        })
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
      // The project page URL, prefetched while the panel is open. `null` means
      // "not resolved yet"; the button stays enabled either way, because the
      // fallback is a real destination rather than a failure.
      const [projectLink, setProjectLink] = useState(null)
      // Set when the browser refused to open a tab, so the button can say why
      // instead of appearing to do nothing.
      const [linkFailure, setLinkFailure] = useState(false)

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
      //
      // The visibility filter is applied HERE, before grouping, search, column
      // planning and the trigger's label resolution, so every downstream
      // consumer sees exactly one catalogue. A hidden provider therefore cannot
      // reach the grid, the search index, the group headings or the model count
      // by any route — there is no second place to remember to filter.
      const groups = useMemo(() => derive('grouping providers', () => {
        const visible = visibleGroups(state.groups, hidden)
        const ranked = visible.map((group, index) => ({ group, index }))
        const rankOf = value => (value.group.id === 'deepseek-account' ? 0
          : value.group.id === 'deepseek-official' ? 1 : 2)
        ranked.sort((left, right) => rankOf(left) - rankOf(right) || left.index - right.index)
        return ranked.map(entry => entry.group)
      }, []), [state.groups, hidden])

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
        const providerLabelOf = group => providerLabel(group, t, resolveText, aliasOf(providerAliases, group.id))
        /**
         * The catalog's own name for the same provider, ignoring any alias.
         *
         * It is not drawn in the picker — the user chose the alias — but the
         * family-row tail strips provider words, and a model name usually
         * carries the ORIGINAL provider spelling (`豆包 2.1 Turbo`), so both
         * faces have to be removed or the tail repeats the provider.
         * @param {{id: string, name: unknown}} group - one provider entry.
         * @returns {string} the catalog label.
         */
        const providerOriginalOf = group => providerLabel(group, t, resolveText)
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
            const providerOriginal = providerOriginalOf(group)
            const scored = []
            for (const model of group.models) {
              const score = scoreOf(model, providerHit)
              if (score !== null) {
                // `providerOriginal` is the catalog's name with no alias (the
                // family-row tail strips provider words from a model name, and
                // that name usually carries the original spelling).
                // `providerName` is the same name carried UNRESOLVED for a
                // different reader: the row hands it to the model-label cell,
                // which resolves it with its own locale seat exactly as it does
                // inside the shipped picker (DEC-046).
                scored.push({
                  entry: {
                    model, providerId: group.id, providerLabel, providerOriginal, providerName: group.name,
                  },
                  score,
                })
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
          const providerOriginal = providerOriginalOf(group)
          for (const model of group.models) {
            const score = scoreOf(model, providerHit)
            if (score === null) continue
            const family = familyOf(model)
            let bucket = buckets.get(family)
            if (bucket === undefined) {
              bucket = { key: family, title: family, scored: [] }
              buckets.set(family, bucket)
            }
            bucket.scored.push({
              entry: {
                model, providerId: group.id, providerLabel, providerOriginal, providerName: group.name,
              },
              score,
            })
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
              // the family and the provider draws no tail at all. Only the
              // catalog spelling is stripped: the alias is a user label, not a
              // guaranteed part of the model name — stripping a word like `Pro`
              // from `Claude 3.5 Pro Sonnet` would mangle the model's own name.
              const variant = rowVariantOf(
                item.entry.model,
                family.title,
                item.entry.providerOriginal,
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
      }, []), [grouping, groups, query, t, resolveText, providerAliases])

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
        setLinkFailure(false)
        load()
        const timer = window.setTimeout(() => { searchRef.current?.focus() }, 0)
        return () => { window.clearTimeout(timer) }
      }, [open, load])

      // Prefetch the project page URL while the panel is open.
      //
      // Doing this on open rather than on click is what lets the click open the
      // tab SYNCHRONOUSLY: `window.open` after an `await` is a popup the browser
      // may block, and a link button that only sometimes opens is worse than one
      // that always does. The fetch is cancelled on close and on unmount, so a
      // panel nobody is looking at holds no request open.
      useEffect(() => {
        if (!open) return undefined
        let cancelled = false
        fetchProjectLink().then(result => {
          if (!cancelled) setProjectLink(result)
        })
        return () => { cancelled = true }
      }, [open])

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
            name: providerNameFor(group, t),
          },
          model: currentModel.model,
          placement: 'trigger',
          selected: true,
        }
      }, [currentModel, t])
      /**
       * The halves of the occupant's props that are the SAME for every cell it
       * decorates: its business inject (built once per entry) and its own
       * locale seat.
       *
       * Split out of `labelNode` when the model ROWS started hosting the same
       * cell (DEC-046). The face depends on the Session, not on the row, so a
       * panel of twenty rows builds one face rather than twenty —
       * `entry.inject(sessionId)` reads services and assembles an object, and
       * the native picker likewise builds it once per picker, not per row.
       */
      const labelFaceValue = useMemo(() => (labelEntry === undefined || typeof props.labelFace !== 'function'
        ? EMPTY_LABEL_FACE
        : derive('building the model label face', () => props.labelFace(labelEntry), {})),
      [labelEntry, props.labelFace])
      const labelTranslate = useMemo(() => (labelEntry === undefined || typeof props.labelSeatFor !== 'function'
        ? identityTranslate
        : derive('binding the model label locale', () => props.labelSeatFor(labelEntry.locale), identityTranslate)),
      [labelEntry, props.labelSeatFor])

      /**
       * The occupant's props for the TRIGGER, assembled once per (entry, model).
       *
       * The identity has to be stable across renders: the occupant is an
       * ordinary React component, and a fresh props object on every paint makes
       * a memoized one re-render forever.
       */
      const labelNode = useMemo(() => {
        if (labelEntry === undefined || labelOwnerProps === undefined) return undefined
        const Occupant = labelEntry.component
        return h(LabelBoundary, {
          // Keyed by the winner, so a change of occupant remounts rather than
          // handing one plugin's component another plugin's state.
          key: `label-${labelEntry.options?.id ?? labelEntry.registrant ?? 'entry'}`,
          fallback: undefined,
        }, h(Occupant, { ...labelFaceValue, t: labelTranslate, ...labelOwnerProps }))
      }, [labelEntry, labelOwnerProps, labelFaceValue, labelTranslate])

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
       * The name runs come from the module-level `nameRuns` so the panel and the
       * Settings model list lift a "· x0.01" rate identically (DEC-048). Only
       * the marker regex and the split live there now; this comment records
       * the grammar: an x (any case, or the multiplication sign) that STARTS a
       * token — preceded by start-of-string or a non-word character, so it is
       * not embedded in a word like "GenX5" — followed by optional whitespace
       * and a number (integer or decimal, optional leading +). "Claude x3",
       * "GPT x0.1", "Model X 2.2" all get the run; a plain "Model X" (no
       * number) or "GenX5" (x inside a word) do not.
       */
      /**
       * One row's cell, drawn by the picker's own render view (DEC-046).
       *
       * The shipped `ModelSelect` renders every selectable model through the
       * `conversation.input.model.label` cell — the catalog name plus whatever
       * the winning connection plugin decorates it with: its live rate
       * multiplier, a promotion chip, and its load mark. This plugin shadows
       * that picker, so the cell's DECLARATION survives while its renderer does
       * not run. Reading the winning entry and rendering the occupant here is
       * exactly what `ModelSelect` does with its `renderModelLabel` helper —
       * same props (`provider`/`model`/`placement`/`selected`), same roles, so
       * a row shows what the native row shows instead of a second, poorer
       * approximation of it.
       *
       * NOTHING IS GUESSED FROM THE OCCUPANT. Its output is opaque: this plugin
       * cannot split "the name" from "the decorations", so hosting the cell
       * means hosting all of it — which is why a row that hosts it does NOT
       * also draw the catalog badge (the occupant draws that badge itself on a
       * foreign row, and a second chip beside it would read as two models) or
       * this plugin's `xN` lift (the occupant draws its own rate span).
       *
       * @param entry - the row's `{ model, providerId, providerLabel, providerName }`.
       * @param primary - the row's primary text, used only by the fallback.
       * @param selected - whether this row is the current selection.
       * @returns the boundary-wrapped occupant, or null when no occupant wins.
       */
      const renderRowLabel = (entry, primary, selected) => {
        if (labelEntry === undefined) return null
        const { model, providerId, providerLabel, providerName } = entry
        const Occupant = labelEntry.component
        // Resolved once: the fallback draws it, and `renderRow` needs to know
        // whether one exists before deciding not to draw its own.
        const badge = badgeOf(model)
        return h(LabelBoundary, {
          // Keyed by the route, so a change of occupant (or of the model a row
          // stands for) remounts rather than handing one plugin's component
          // another row's state.
          key: `row-label-${providerId}/${model?.id}`,
          // A crashing occupant costs the DECORATION, never the row: the
          // boundary falls back to exactly what this row drew before it hosted
          // the cell — the catalog name with its multiplier markers lifted, and
          // the catalog badge, which is the one piece of decoration this plugin
          // can still draw without the occupant. Suppression of `dshmf-badge` in
          // `renderRow` is keyed on the cell being HOSTED, not on it having
          // rendered, so a crash would otherwise lose the badge as well as the
          // chips — and the badge is not the occupant's to lose.
          fallback: h('span', { className: 'dshmf-rowLabelFallback' },
            ...nameRuns(primary),
            badge === null ? null : h('span', {
              className: 'dshmf-badge',
              'data-tone': badge.tone,
            }, badge.label)),
        }, h(Occupant, {
          ...labelFaceValue,
          t: labelTranslate,
          provider: {
            id: providerId,
            // The catalog's own name, unresolved, except for the one provider
            // the shipped picker localizes on the occupant's behalf. A group's
            // `name` is preferred over the row's `providerName` because the row
            // entry carries it for the family tail's stripping, where an alias
            // must not be used.
            name: typeof providerName === 'string' && providerName !== ''
              ? providerNameFor({ id: providerId, name: providerName }, t)
              : providerLabel,
          },
          model,
          // `option` is the placement a selectable model row has in the shipped
          // picker (`trigger` is the composer chip, `menu` the root menu's
          // current-value cell). It is also what makes an occupant render its
          // COMPACT decoration, which is what a row has room for.
          placement: 'option',
          selected,
        }))
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
        // The picker's own render view for a model row (DEC-046), or null when
        // no occupant wins the cell. Under FAMILY grouping the row's primary
        // text is the provider, not the model, so the cell's output (a model
        // name plus its decorations) is not what that row is about: the cell is
        // hosted only where the row stands for a MODEL, which is provider
        // grouping. The tail below then carries what the occupant would have
        // said anyway — the model's own variant and its rate multiplier.
        const nativeCell = familyMode ? null : renderRowLabel(entry, primary, selected)
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
          // The row's accessible name, spelled out rather than inherited from
          // its content. Once a row hosts the shipped cell, its text comes from
          // ANOTHER PLUGIN: an occupant may render nothing (a crash is caught by
          // `LabelBoundary`, but rendering `null` is not a crash), and the row
          // would then be a nameless button. The model name is what the row is,
          // so it is stated here and never depends on the decoration.
          'aria-label': String(model.name ?? ''),
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
          //
          // A row that hosts the picker's own render view draws THAT as its
          // primary text instead (DEC-046): the occupant already spells the
          // name, lifts the rate and adds its chips, so re-applying `nameRuns`
          // to it would decorate the same characters twice. The window and the
          // one-pass marquee still wrap it — a decorated row can be wider than
          // its column like any other.
          //
          // That does mean the occupant's own chips sit INSIDE the clipping
          // window, so a narrow column can cut one, and a marquee pass carries
          // them along with the name (DEC-047). The shipped picker has the same
          // property — its `.modelName` clips a `.badgedName` that contains the
          // badge — so this is the native behaviour, not a regression; only the
          // plugin's OWN chips (the family tail, the catalog badge, the spinner)
          // stay outside the clip and never move.
          nativeCell !== null
            ? h('span', { className: 'dshmf-rowNameWindow' },
              running
                ? renderNameTrack({ shift: marquee.shift, duration: marquee.duration, children: nativeCell })
                : h('span', { className: 'dshmf-rowNameTrack dshmf-rowName' }, nativeCell),
            )
            : h('span', { className: 'dshmf-rowNameWindow' },
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
          // The catalog badge is the FALLBACK's decoration. The shipped picker
          // draws it only when no label occupant answered (its `renderSlot`
          // fallback), and an occupant that holds the cell draws the host's own
          // `model.badge` itself — so a row hosting the cell must NOT also draw
          // this chip, or a badged model shows two.
          nativeCell !== null || badge === null ? null : h('span', {
            className: 'dshmf-badge',
            'data-tone': badge.tone,
          }, badge.label),
          pendingThis ? h('span', { className: 'dshmf-rowTail' }, h('span', { className: 'dshmf-spin' })) : null,
        )
      }

      const showEmptyState = sections.length === 0 && !busy
      // Three different reasons the grid can be empty, and they must not share
      // one sentence: a catalogue that is still loading, a catalogue with
      // nothing in it, a search that matched nothing, and a catalogue whose
      // every entry the user has switched off in Settings. The last one is not
      // a fault and the panel cannot fix it, so it says where to fix it.
      const emptyKey = state.status === 'loading' && totalModels === 0
        ? 'status.loading'
        : totalModels === 0
          ? (state.groups.length > 0 ? 'empty.hidden' : 'empty.models')
          : 'empty.search'

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
        name: aliasOf(providerAliases, failure.id)
          ?? (failure.id === 'deepseek-account' ? t('provider.account') : failure.name),
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

                // ---- the trailing PAIR: the project link and the display
                // mode button, as ONE footer child.
                // They are grouped rather than siblings because the footer's
                // own 30px column-gap applies between its flex items, and it
                // would otherwise land between these two buttons — no margin
                // on either could shrink it. As one item, that 30px separates
                // the pair from the groups to its left, and the space INSIDE
                // is this container's 2px gap.
                h('div', { className: 'dshmf-actions' },
                  // The icon IMMEDIATELY LEFT of the display-mode button. It
                  // opens the repository page this checkout configures, in a
                  // new tab. It is never disabled for "no remote": the Host
                  // answers with this project's own page in that case, which is
                  // a real destination rather than a failure. The only thing
                  // that can make it unusable is a browser refusing the tab,
                  // and that is reported in the tooltip instead of being
                  // pre-empted.
                  h('button', {
                    type: 'button',
                    className: 'dshmf-linkBtn',
                    'aria-label': t('link.label'),
                    title: linkFailure
                      ? t('link.failed')
                      : (projectLink === null
                        ? t('link.open')
                        : (projectLink.source === 'remote'
                          ? fill(t, 'link.openFrom', { url: projectLink.url })
                          : t('link.fallback'))),
                    'data-source': projectLink === null ? undefined : projectLink.source,
                    onClick: () => { openProjectLink() },
                  }, svg(PATH_LINK, 12)),

                  // Display mode: hand the seat back to the Host's own picker,
                  // or take it back. One button, `aria-pressed` carrying the
                  // state. The PAIR holds the auto margin that pins it to the
                  // panel's bottom-right, so this button keeps no margin of its
                  // own and stays beside the icon.
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
    // The catalogue face the Settings section reads.
    //
    // The section lives in the Settings panel, which has no Session, so it
    // cannot use `modelDirectories.directoryFor(sessionId)` the way the
    // composer seat does. The Host's catalog is not Session-scoped though:
    // `remote.session.modelCatalog()` answers one catalog per Host generation
    // and every Session selector folds it. Reading it directly is therefore the
    // same data the panel draws, without inventing a Session.
    //
    // Two rules keep this face from ever costing the Settings page:
    //
    // 1. **Resolved lazily, through `ctx.get`.** The namespace service may
    //    still be mounting when this store is built, and `ctx.get` returns
    //    `undefined` instead of throwing on a missing service.
    // 2. **`ok:false` and a thrown call both mean "no catalogue".** A Remote
    //    call resolves to `{ok, value}` / `{ok, error}`; only assembly faults
    //    reject. Neither is an error the user can act on here, so the section
    //    says the catalogue has not loaded rather than showing a failure.
    // ---------------------------------------------------------------------
    const CATALOG_EMPTY = { status: 'idle', groups: [], error: null }

    /**
     * Build the catalogue store shared by the Settings section.
     * @param deps - `read` resolves a Client service by name.
     * @returns a snapshot store with an idempotent `load`.
     */
    function createCatalogStore(deps) {
      let snapshot = CATALOG_EMPTY
      const listeners = new Set()
      let inflight
      const notify = () => {
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch {
            /* one bad subscriber must not starve the others */
          }
        }
      }
      const publish = next => {
        snapshot = next
        notify()
      }
      return {
        getSnapshot: () => snapshot,
        subscribe: listener => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        /**
         * Read the Host's catalog once, sharing any in-flight read.
         * @returns {Promise<void>} settles when the snapshot is final.
         */
        load: () => {
          if (snapshot.status === 'ready') return Promise.resolve()
          if (inflight !== undefined) return inflight
          const service = (() => {
            try {
              return typeof deps.read === 'function' ? deps.read('remote.session') : undefined
            } catch {
              return undefined
            }
          })()
          if (service === undefined || typeof service.modelCatalog !== 'function') {
            publish({ status: 'unavailable', groups: [], error: null })
            return Promise.resolve()
          }
          publish({ status: 'loading', groups: snapshot.groups, error: null })
          inflight = Promise.resolve()
            .then(() => service.modelCatalog())
            .then(result => {
              // The envelope is `RemoteResult<ModelCatalog>`, never the
              // catalog itself: unwrapping it twice would read `.groups` off
              // `undefined` and blank the page.
              if (result === null || typeof result !== 'object' || result.ok !== true) {
                publish({ status: 'unavailable', groups: [], error: null })
                return
              }
              const value = result.value
              const groups = Array.isArray(value?.groups) ? value.groups : []
              publish({ status: 'ready', groups, error: null })
            })
            .catch(() => {
              publish({ status: 'unavailable', groups: [], error: null })
            })
            .finally(() => { inflight = undefined })
          return inflight
        },
        dispose: () => { listeners.clear() },
      }
    }

    /** Frozen catalogue face for a degraded Settings render. */
    const EMPTY_CATALOG = {
      getSnapshot: () => CATALOG_EMPTY,
      subscribe: () => () => {},
      load: () => Promise.resolve(),
    }

    /**
     * One switch, drawn with the settings domain's own geometry.
     *
     * Deliberately NOT imported from `@deepseek-ai/dsh-client-ui-primitives`:
     * that package is a seed word of the module table, not an installed
     * package, so requiring it would make this bundle depend on an internal
     * host artifact that has no manifest and can change without notice. The
     * markup and the base CSS rules below reproduce it exactly instead; the
     * model variant layers one tint rule on top.
     * @param props - `checked`, `onChange`, `label`, plus optional `disabled`,
     * `mixed`, and `className` (the model rows pass one for the distinct tint).
     */
    function Switch(props) {
      const { checked, onChange, label, disabled, mixed, className } = props
      return h('button', {
        type: 'button',
        role: 'switch',
        // `mixed` is the third state a bulk switch needs: a provider with some
        // of its models on. `aria-checked="mixed"` is the standard way to say
        // that, so assistive tech reports it without extra markup.
        'aria-checked': mixed === true ? 'mixed' : checked === true,
        'aria-label': label,
        disabled: disabled === true,
        className: className === undefined ? 'dshmf-switch' : `dshmf-switch ${className}`,
        'data-mixed': mixed === true,
        onClick: () => { if (disabled !== true) onChange(checked !== true) },
      }, h('span', { className: 'dshmf-switchThumb' }))
    }

    /**
     * The routes the Settings list should call out as out of credit.
     *
     * The panel answers this question with a strike through the row text; the
     * Settings list says it in words under the name instead (see
     * `.dshmf-setNoCredit`). Both read the SAME live mark map, so the two
     * surfaces can never disagree.
     *
     * Two levels come out of one pass: a model is noted when its own route is
     * marked, and a provider is noted only when it has models and EVERY one of
     * them is marked — a partly-out provider would otherwise claim a fact the
     * user can see is untrue one level down. An empty group never qualifies:
     * that is "the catalogue has not loaded", not "the account is out".
     *
     * Visibility is deliberately NOT consulted. Hiding is a display choice; it
     * must not be able to manufacture "this whole provider is out" by hiding
     * the half that still answers.
     * @param marked - the live mark map from the store snapshot (route → true).
     * @param groups - the catalogue's provider groups.
     * @returns the marked route keys and the all-out provider ids.
     */
    function creditNotes(marked, groups) {
      const models = new Set()
      const providers = new Set()
      const list = Array.isArray(groups) ? groups : []
      if (marked === undefined || marked === null || typeof marked.get !== 'function') {
        return { models, providers }
      }
      for (const group of list) {
        const modelsOf = Array.isArray(group?.models) ? group.models : []
        let struck = 0
        for (const model of modelsOf) {
          const route = routeKeyOf(group?.id, model?.id)
          if (marked.get(route) !== true) continue
          models.add(route)
          struck += 1
        }
        if (modelsOf.length > 0 && struck === modelsOf.length) providers.add(String(group?.id ?? ''))
      }
      return { models, providers }
    }

    /**
     * The Settings section: every provider with a switch, and its models with
     * one switch each.
     *
     * A provider row is the CONTROL, not a summary of its children: switching a
     * provider off hides all of its models whatever their own records say (see
     * `modelIsVisible`), and switching it back on restores exactly the
     * per-model exceptions it had. The row also reports how many of its models
     * are hidden, so a collapsed provider still says what it is hiding.
     *
     * Both levels also report the account's balance verdict in words under the
     * name — see {@link creditNotes}.
     * @param props - the settings slot's props plus the injected face.
     */
    function SettingsSection(props) {
      const { t, visibility, catalog, insufficient, telemetry, aliases, resolveText } = props
      const visibleFace = visibility ?? ALL_VISIBLE
      const subscribeHidden = useCallback(listener => visibleFace.subscribe(listener), [visibleFace])
      const getHidden = useCallback(() => visibleFace.getSnapshot(), [visibleFace])
      const hidden = useSyncExternalStore(subscribeHidden, getHidden, getHidden)

      // The names the user chose, from the SAME page-wide store the picker
      // reads. A save here re-renders an open panel with no reload.
      const aliasFace = aliases ?? NO_ALIASES
      const subscribeAliases = useCallback(listener => aliasFace.subscribe(listener), [aliasFace])
      const getAliases = useCallback(() => aliasFace.getSnapshot(), [aliasFace])
      const aliasMap = useSyncExternalStore(subscribeAliases, getAliases, getAliases)

      // The ONE global balance store, the same face the panel reads. The marks
      // are not Session state, so the section shows exactly what the panel shows.
      const markFace = insufficient ?? EMPTY_INSUFFICIENT
      const subscribeMarks = useCallback(listener => markFace.subscribe(listener), [markFace])
      const getMarks = useCallback(() => markFace.getSnapshot(), [markFace])
      const marks = useSyncExternalStore(subscribeMarks, getMarks, getMarks)

      const catalogFace = catalog ?? EMPTY_CATALOG
      const subscribeCatalog = useCallback(listener => catalogFace.subscribe(listener), [catalogFace])
      const getCatalog = useCallback(() => catalogFace.getSnapshot(), [catalogFace])
      const catalogue = useSyncExternalStore(subscribeCatalog, getCatalog, getCatalog)

      // The telemetry toggle. Defaults to ON (TELEMETRY_ON) so a degraded
      // activation still renders the row in its real, opt-out-default state.
      const telemetryFace = telemetry ?? TELEMETRY_ON
      const subscribeTelemetry = useCallback(listener => telemetryFace.subscribe(listener), [telemetryFace])
      const getTelemetry = useCallback(() => telemetryFace.getSnapshot(), [telemetryFace])
      const telemetryOn = useSyncExternalStore(subscribeTelemetry, getTelemetry, getTelemetry)

      // Read the catalog when the page opens. The effect is idempotent: a
      // second visit re-reads only when the first one never produced a
      // catalogue, so switching sections back and forth costs nothing.
      useEffect(() => { catalogFace.load() }, [catalogFace])

      // Fold a record written by the previous design into per-model keys, now
      // that the catalogue names the models those keys covered. Runs whenever a
      // catalogue is available; it is idempotent, so a re-render costs nothing
      // and a catalogue that arrives late is still handled.
      const catalogueGroups = Array.isArray(catalogue.groups) ? catalogue.groups : []
      useEffect(() => {
        if (catalogueGroups.length === 0) return
        visibleFace.migrateLegacy(catalogueGroups)
      }, [visibleFace, catalogueGroups])

      const [expanded, setExpanded] = useState(() => new Set())
      const toggleExpanded = id => {
        setExpanded(previous => {
          const next = new Set(previous)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }

      const translate = typeof t === 'function' ? t : key => key
      const fillText = (key, values) => {
        const template = String(translate(key))
        if (values === undefined) return template
        return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''))
      }

      // The ONE inline editor. Only one provider is renamed at a time, which
      // keeps focus handling honest and makes the helper line's id unique.
      const [editing, setEditing] = useState(null)
      const [draft, setDraft] = useState('')
      const cancelRef = useRef(false)
      const suppressBlurRef = useRef(false)
      const renameRefs = useRef(new Map())
      const renameId = group => String(group?.id ?? '')
      /** Return focus to the pencil that opened the editor, after React commits. */
      const focusRename = id => {
        const run = () => { renameRefs.current.get(id)?.focus?.() }
        if (typeof queueMicrotask === 'function') queueMicrotask(run)
        else if (typeof setTimeout === 'function') setTimeout(run, 0)
      }
      const beginRename = group => {
        const id = renameId(group)
        cancelRef.current = false
        setEditing(id)
        setDraft(aliasOf(aliasMap, id) ?? '')
      }
      const closeRename = (id, restoreFocus = true) => {
        setEditing(null)
        setDraft('')
        if (restoreFocus) focusRename(id)
      }
      const commitRename = (group, restoreFocus = true) => {
        const id = renameId(group)
        // `aliasFor` turns blank and equal-to-original drafts into "no alias",
        // so clearing the record restores whatever the catalog says now.
        aliasFace.setAlias(id, aliasFor(draft, providerLabel(group, translate, undefined)))
        closeRename(id, restoreFocus)
      }
      const cancelRename = group => {
        cancelRef.current = true
        closeRename(renameId(group))
      }
      const resetRename = group => {
        aliasFace.setAlias(renameId(group), undefined)
        closeRename(renameId(group))
      }

      const groups = Array.isArray(catalogue.groups) ? catalogue.groups : []
      // Both credit-note levels from one pass over the live mark map — see
      // `creditNotes`. Computed once per render, not per row.
      const notes = creditNotes(marks.marks, groups)
      const creditHint = translate('noCreditHint')
      /** The catalog's own name, ignoring any alias. */
      const originalOf = group => providerLabel(group, translate, undefined)
      /** The name this page draws: the alias when one exists. */
      const labelOf = group => providerLabel(group, translate, undefined, aliasOf(aliasMap, group.id))
      const setVisible = (key, visible) => visibleFace.setVisible(key, visible)
      const setGroup = (group, visible) => visibleFace.setGroupVisible(group, visible)

      /**
       * The inline editor for one provider.
       *
       * It replaces the disclosure rather than sitting beside it: the provider
       * name is a button, and an input inside a button is invalid markup and
       * unusable by keyboard. The ghost chevron keeps the field aligned with
       * the collapsed name; the switch stays where it was, so the row does not
       * jump around it.
       * @param group - the provider being renamed.
       * @returns the editor block.
       */
      const renderEditor = group => {
        const id = renameId(group)
        const original = originalOf(group)
        const current = aliasOf(aliasMap, id)
        const next = aliasFor(draft, original)
        const saveDisabled = (next ?? '') === (current ?? '')
        const folded = value => sanitizeAlias(value).toLowerCase()
        const normalized = folded(draft)
        let clash = false
        if (normalized !== '' && normalized !== folded(original)) {
          for (const other of groups) {
            const otherId = renameId(other)
            if (otherId === id) continue
            // A collision is a collision whether the other provider got the
            // name in the catalog or from an earlier rename, and `Work` vs
            // `work` would still read as the same heading.
            if (folded(originalOf(other)) === normalized
              || folded(aliasOf(aliasMap, otherId)) === normalized) {
              clash = true
              break
            }
          }
        }
        const composing = event => event?.isComposing === true
          || event?.nativeEvent?.isComposing === true
          || event?.keyCode === 229
        const onBlur = event => {
          if (cancelRef.current) {
            cancelRef.current = false
            return
          }
          if (suppressBlurRef.current) {
            suppressBlurRef.current = false
            return
          }
          const focused = event?.relatedTarget
          const currentTarget = event?.currentTarget
          if (focused !== null && focused !== undefined && currentTarget !== null
            && currentTarget !== undefined && typeof currentTarget.contains === 'function'
            && currentTarget.contains(focused)) return
          // Leaving the editor commits. A pointer that lands on one of the
          // editor's own controls arms `suppressBlurRef` first (see
          // `onEditorMouseDown`), so that control's handler decides the outcome
          // instead — never a save followed by a cancel. Focus is NOT pulled
          // back to the pencil here: the pointer has already moved to whatever
          // was clicked.
          commitRename(group, false)
        }
        const onKeyDown = event => {
          const key = event?.key
          if (key !== 'Enter' && key !== 'Escape') return
          // An IME uses Enter to accept a candidate and Escape to dismiss it;
          // committing or cancelling then would act on half a name. 229 is the
          // legacy keyCode some engines still report for that keypress.
          if (composing(event)) return
          // Both keys belong to the editor while it is open: without this the
          // Settings panel would also treat Escape as "close the panel".
          event?.preventDefault?.()
          event?.stopPropagation?.()
          if (key === 'Enter') commitRename(group)
          else cancelRename(group)
        }
        // The wrapper only owns Escape. Enter must stay with the control that
        // has focus: on the Cancel button it activates Cancel, and swallowing
        // it here would commit the draft instead.
        const onEditorKeyDown = event => {
          if (event?.key !== 'Escape' || composing(event)) return
          event?.preventDefault?.()
          event?.stopPropagation?.()
          cancelRename(group)
        }
        const onEditorMouseDown = event => {
          const tag = String(event?.target?.tagName ?? '').toUpperCase()
          if (tag === 'INPUT') return
          if (tag === 'BUTTON' || tag === 'PATH' || tag === 'SVG') {
            // A control's own click decides the outcome. Focus may move to it,
            // but the resulting blur must not commit first (on touch, where a
            // Cancel tap must never save the draft). The flag clears on the
            // click or on the next tick if no click follows.
            suppressBlurRef.current = true
            if (typeof setTimeout === 'function') {
              setTimeout(() => { suppressBlurRef.current = false }, 0)
            }
            return
          }
          // Padding, the ghost chevron and the helper line are not controls;
          // keep focus in the field when they are clicked.
          event?.preventDefault?.()
        }
        /** Run one editor control action after cancelling any pending blur. */
        const act = action => {
          suppressBlurRef.current = false
          action()
        }
        return h('div', {
          className: 'dshmf-setEditorWrap',
          onBlur,
          onKeyDown: onEditorKeyDown,
          // Pointerdown fires before focus moves on mouse AND touch. Without
          // it, a tap on Cancel could blur-commit first and cancel a closed
          // editor, i.e. save the very draft the user rejected.
          onPointerDown: onEditorMouseDown,
          onMouseDown: onEditorMouseDown,
        },
          h('div', { className: 'dshmf-setEditor' },
            svg(PATH_CHEVRON, 13, { className: 'dshmf-setEditorChevron' }),
            h('span', { className: 'dshmf-setField' },
              h('input', {
                className: 'dshmf-setInput',
                type: 'text',
                value: draft,
                placeholder: original,
                autoFocus: true,
                autoComplete: 'off',
                spellCheck: false,
                enterKeyHint: 'done',
                dir: 'auto',
                'aria-label': fillText('alias.field', { original }),
                'aria-describedby': 'dshmf-alias-hint',
                onFocus: event => event?.currentTarget?.select?.(),
                onKeyDown,
                onChange: event => {
                  // Clamp by CODE POINT, not by the input's `maxLength` (which
                  // counts UTF-16 units and would halve an emoji name). When the
                  // clamp bites, the DOM is corrected directly: React bails out
                  // on an unchanged state value, so without this the field would
                  // keep showing a name longer than the one that gets saved.
                  const target = event?.target
                  const raw = String(target?.value ?? '')
                  const clamped = [...raw].slice(0, ALIAS_MAX).join('')
                  if (clamped !== raw && target) target.value = clamped
                  setDraft(clamped)
                },
              }),
              current === undefined
                ? null
                : h('button', {
                  type: 'button',
                  className: 'dshmf-setAliasReset',
                  title: fillText('alias.reset', { original }),
                  'aria-label': fillText('alias.reset', { original }),
                  onClick: () => act(() => resetRename(group)),
                }, svg(PATH_RESET, 12))),
            h('button', {
              type: 'button',
              className: 'dshmf-setEditBtn dshmf-setSaveBtn',
              title: translate('alias.save'),
              'aria-label': translate('alias.save'),
              disabled: saveDisabled,
              onClick: () => act(() => commitRename(group)),
            }, svg(PATH_CONFIRM, 13)),
            h('button', {
              type: 'button',
              className: 'dshmf-setEditBtn',
              title: translate('alias.cancel'),
              'aria-label': translate('alias.cancel'),
              onClick: () => act(() => cancelRename(group)),
            }, svg(PATH_CLOSE, 12))),
          h('p', { className: 'dshmf-setEditHint', id: 'dshmf-alias-hint' },
            h('span', { className: 'dshmf-setEditOriginal', title: original },
              fillText('alias.original', { original })),
            // The live region is mounted for the editor's whole life, even when
            // empty: a `role="status"` created at the moment of the clash would
            // not be announced by most screen readers.
            h('span', {
              className: 'dshmf-setEditStatus',
              role: 'status',
              'aria-live': 'polite',
            }, clash ? translate('alias.duplicate') : ''),
            clash
              ? null
              : h('span', { className: 'dshmf-setEditKeys' }, translate('alias.keyboard'))))
      }

      const rows = groups.map(group => {
        const isOpen = expanded.has(group.id)
        const models = Array.isArray(group.models) ? group.models : []
        const state = groupVisibility(hidden, group)
        const title = labelOf(group)
        const original = originalOf(group)
        const id = renameId(group)
        const alias = aliasOf(aliasMap, id)
        const editingThis = editing === id
        return h('div', { className: 'dshmf-setProvider', key: group.id, 'data-hidden': state.allHidden },
          h('div', {
            className: 'dshmf-setProviderRow',
            'data-editing': editingThis ? 'true' : undefined,
          },
            editingThis
              // The editor replaces the disclosure: an input nested inside the
              // disclosure button would be invalid and unreachable by pointer.
              ? renderEditor(group)
              // The disclosure is the WHOLE text area, not the chevron alone:
              // the name, the model count and the chevron are one button, so a
              // click anywhere on that side of the row expands the provider.
              : h('button', {
                type: 'button',
                className: 'dshmf-setDisclosure',
                'aria-expanded': isOpen,
                'aria-label': `${isOpen ? translate('collapse') : translate('expand')} ${title}`,
                onClick: () => toggleExpanded(group.id),
              },
                svg(PATH_CHEVRON, 13, { className: isOpen ? 'dshmf-setChevron dshmf-setChevronOpen' : 'dshmf-setChevron' }),
                // The row's own text lives INSIDE the disclosure button (see
                // above), so the whole text side is one click target. The meta
                // line reports the bulk state: "all off" when nothing is on, and
                // how many are on when the user has switched a few back on.
                h('span', { className: 'dshmf-setProviderText' },
                  h('span', { className: 'dshmf-setProviderName', title }, title),
                  h('span', { className: 'dshmf-setProviderMeta' },
                    fillText('models', { count: models.length }),
                    state.allHidden
                      ? ` · ${translate('allOff')}`
                      : state.mixed
                        ? ` · ${fillText('visibleCount', { count: state.visible })}`
                        : null,
                    alias === undefined
                      ? null
                      : h('span', { className: 'dshmf-setProviderOriginal' },
                        ` · ${fillText('alias.original', { original })}`)),
                  // Under the provider name, and only when every model of this
                  // provider is out — see `creditNotes`. The per-model rows say
                  // it individually, so this line never implies a fact the user
                  // can see is untrue one level down. It sits AFTER the meta
                  // line so a collapsed row still shows it.
                  notes.providers.has(String(group.id ?? ''))
                    ? h('span', { className: 'dshmf-setNoCredit', title: creditHint }, translate('allNoCredit'))
                    : null)),
            // Pencil and switch are ONE trailing group: the row already spaces
            // its two sides by 16px, and letting each control be its own flex
            // item would put 32px of air around a 22px button.
            h('div', { className: 'dshmf-setActions' },
              editingThis
                ? null
                : h('button', {
                  type: 'button',
                  className: 'dshmf-setRenameBtn',
                  'data-renamed': alias === undefined ? 'false' : 'true',
                  title: alias === undefined
                    ? fillText('alias.editLabel', { name: original })
                    : fillText('alias.renamedLabel', { name: alias, original }),
                  'aria-label': alias === undefined
                    ? fillText('alias.editLabel', { name: original })
                    : fillText('alias.renamedLabel', { name: alias, original }),
                  ref: node => {
                    if (node === null || node === undefined) renameRefs.current.delete(id)
                    else renameRefs.current.set(id, node)
                  },
                  onClick: () => beginRename(group),
                }, svg(PATH_PENCIL, 13)),
              h(Switch, {
                // The provider switch reports its models and writes them all; it
                // has no state of its own. `checked` is "every model is on", and
                // `mixed` is a provider the user has partly switched back on.
                checked: state.allVisible,
                mixed: state.mixed,
                label: fillText('providerToggle', { name: title }),
                // Switching ON from a mixed state is the useful reading of "turn
                // this provider on": make it fully on, not toggle one model.
                onChange: next => setGroup(group, next),
              }))),
          isOpen
            ? h('div', { className: 'dshmf-setModels' }, ...models.map(model => {
              const modelTitle = typeof model?.name === 'string' ? model.name : String(model?.id ?? '')
              // Always interactive: the provider switch above is a bulk action,
              // not a parent that locks its children, so a model can be
              // switched back on while its provider stays mostly off.
              const own = modelIsVisible(hidden, group.id, model.id)
              const out = notes.models.has(routeKeyOf(group.id, model.id))
              // The row carries the same catalog facts the picker's rows do, in
              // the same order: the rate/multiplier inside the name ("· x0.01",
              // lifted out by `nameRuns`) and the catalog's own badge chip after
              // it ("Free Now", "繁忙"). Settings is where a model is turned on
              // or off, so "what is this model, and is it the cheap one right
              // now" has to be answerable without opening the picker.
              const badge = catalogBadge(model, resolveText)
              return h('div', { className: 'dshmf-setModelRow', key: String(model?.id ?? ''), 'data-hidden': !own },
                // The name (with its chip) on one line, the credit note — when
                // the account is out — on the line UNDER it, so the two facts
                // never compete for the same run of text.
                h('span', { className: 'dshmf-setModelText' },
                  h('span', { className: 'dshmf-setModelNameLine' },
                    h('span', { className: 'dshmf-setModelName', title: modelTitle }, ...nameRuns(modelTitle)),
                    badge === null ? null : h('span', {
                      className: 'dshmf-badge dshmf-setModelBadge',
                      'data-tone': badge.tone,
                      title: badge.label,
                    }, badge.label)),
                  out
                    ? h('span', { className: 'dshmf-setNoCredit', title: creditHint }, translate('noCredit'))
                    : null),
                h(Switch, {
                  checked: own,
                  className: 'dshmf-switchModel',
                  label: fillText('modelToggle', { name: modelTitle }),
                  onChange: next => setVisible(modelHiddenKey(group.id, model.id), next),
                }))
            }))
            : null)
      })

      const nothingLoaded = groups.length === 0
      return h('div', { className: 'dshmf-setSection' },
        h('h2', { className: 'dshmf-setTitle' }, translate('title')),
        h('p', { className: 'dshmf-setIntro' }, translate('intro')),
        nothingLoaded
          ? h('p', { className: 'dshmf-setEmpty', role: 'status' }, translate('empty'))
          : h('div', { className: 'dshmf-setList' }, ...rows),
        nothingLoaded ? null : h('p', { className: 'dshmf-setNote' }, translate('note')),
        // The telemetry toggle sits at the BOTTOM of the panel, after the model
        // list, as its own divided band: it governs the whole plugin's one
        // network request, not any single provider or model, so it does not
        // belong inside the list.
        h('div', { className: 'dshmf-setTelemetry' },
          h('div', { className: 'dshmf-setTelemetryRow' },
            h('span', { className: 'dshmf-setTelemetryText' },
              h('span', { className: 'dshmf-setTelemetryTitle' }, translate('telemetry.title')),
              h('span', { className: 'dshmf-setTelemetryDesc' }, translate('telemetry.desc'))),
            h(Switch, {
              checked: telemetryOn === true,
              className: 'dshmf-switchTelemetry',
              label: translate('telemetry.toggle'),
              onChange: next => telemetryFace.setEnabled(next),
            }))))
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
      __test: { marqueePassGeometry, nameClippedBy, MARQUEE_DELAY, MARQUEE_PX_PER_SECOND, MARQUEE_MIN_MS, familyOf, familyRank, familyVariant: rowVariantOf, idVariantOf, matchScore, providerScore, searchTokens, buildUnits, columnHeight, packColumns, planColumns, readGrouping, writeGrouping, GROUPING_KEY, GROUPING_DEFAULT, readDisplayMode, writeDisplayMode, createDisplayModeStore, DISPLAY_MODE_KEY, DISPLAY_MODE_DEFAULT, FLAT_DISPLAY_MODE, isInsufficientBalance, decideMark, eventTimeOf, foldInsufficient, foldMarkEntry, routeOfHeader, routeKeyOf, MARKS_KEY, MARKS_TTL, STRIKE_TTL, markIsLive, parseMarks, serializeMarks, readMarks, writeMarks, createMarkStore, quantizeMetric, metricChanged, METRIC_HYSTERESIS, LabelBoundary, readLabelEntry, labelSeat, labelSlotSource, LABEL_SLOT, providerLabel, fetchProjectLink, openInNewTab, PROJECT_LINK_PATH, PROJECT_LINK_FALLBACK, PROJECT_LINK_TIMEOUT_MS, HIDDEN_KEY, readHidden, writeHidden, providerHiddenKey, modelHiddenKey, modelIsVisible, visibleGroups, createHiddenStore, ALL_VISIBLE, hiddenKeysForGroup, groupVisibility, setGroupVisible, sameKeys, migrateLegacyHidden, NO_ALIASES, createAliasStore, aliasOf, writeAliases, readAliases, aliasFor, sanitizeAlias, ALIAS_MAX, ALIAS_KEY, createCatalogStore, EMPTY_CATALOG, TELEMETRY_KEY, readTelemetryEnabled, writeTelemetryEnabled, syncTelemetryEnabled, createTelemetryStore, TELEMETRY_ON, TELEMETRY_SETTINGS_PATH, SETTINGS_NS, settingsDict, installSettingsNavIcon, SettingsSection, creditNotes, Switch },
      __component: ModelFlatMap,
      __seat: Seat,
      __nativeMenuRow: NativeMenuRow,
      __settingsSection: SettingsSection,
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

        // ---- the visibility store (which providers and models the panel draws)
        //
        // ONE store per activation, read by the panel and written by the
        // Settings section below. `readHidden` already returns an empty record
        // for a missing or unreadable store, so a persistence failure costs the
        // memory of the choice, never the models.
        let hiddenStore
        try {
          hiddenStore = createHiddenStore({ readStored: readHidden, writeStored: writeHidden })
          ctx.effect(() => () => { hiddenStore.dispose?.() }, 'dsh-model-flatmap: visibility')
        } catch (error) {
          console.error('dsh-model-flatmap: the visibility store failed to start', error)
          hiddenStore = ALL_VISIBLE
        }

        // ---- the telemetry toggle (DEC-035)
        //
        // ONE store per activation. The choice lives in `localStorage` and is
        // mirrored to the Host's telemetry-settings route, which the Host
        // re-reads before every send — so flipping the switch here takes effect
        // without a restart. `syncTelemetryEnabled` resolves (never rejects) on
        // an absent route, so a build with no Host half just keeps its local
        // choice; the switch still renders and still means something.
        let telemetryStore
        try {
          telemetryStore = createTelemetryStore({
            readStored: readTelemetryEnabled,
            writeStored: writeTelemetryEnabled,
            sync: syncTelemetryEnabled,
          })
          ctx.effect(() => () => { telemetryStore.dispose?.() }, 'dsh-model-flatmap: telemetry')
        } catch (error) {
          console.error('dsh-model-flatmap: the telemetry store failed to start', error)
          telemetryStore = TELEMETRY_ON
        }
        // Push the stored choice to the Host on activation, so a choice made in
        // an earlier session is honoured by the next heartbeat even if the user
        // never re-opens Settings. Fire-and-forget: it must never block or fail
        // the picker.
        try { void Promise.resolve(telemetryStore.syncNow()).catch(() => {}) } catch { /* never throws */ }
        // ---- the rename store (what the picker calls each provider)
        //
        // ONE store per activation, written by the Settings section and read by
        // every open picker. It is deliberately separate from the hidden record:
        // one is a set of switched-off keys, the other is id -> label. Sharing a
        // record would make the two features' write paths depend on each other.
        let aliasStore
        try {
          aliasStore = createAliasStore({ readStored: readAliases, writeStored: writeAliases })
          ctx.effect(() => () => { aliasStore.dispose?.() }, 'dsh-model-flatmap: provider names')
        } catch (error) {
          console.error('dsh-model-flatmap: the rename store failed to start', error)
          aliasStore = NO_ALIASES
        }

        // ---- the catalogue the Settings section lists
        //
        // Built here (not inside the section) so both share one read: the
        // section may be mounted, unmounted and re-mounted as the user moves
        // between settings pages, and a per-mount read would re-ask the Host
        // every time.
        let catalogStore
        try {
          catalogStore = createCatalogStore({ read })
          ctx.effect(() => () => { catalogStore.dispose?.() }, 'dsh-model-flatmap: settings catalogue')
        } catch (error) {
          console.error('dsh-model-flatmap: the settings catalogue failed to start', error)
          catalogStore = EMPTY_CATALOG
        }

        /**
         * Every OTHER live registration in the model seat, lowest priority
         * first — i.e. in election order, so `[0]` is who wins the cell once
         * our own entry is gone.
         *
         * A `single` slot keeps every registration and elects the LOWEST
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
            const others = all.filter(entry => entry?.component !== Seat)
            // The Host already sorts by priority, but a foreign entry list is
            // not worth trusting: sort again so `[0]` is provably the winner.
            return others.sort((left, right) =>
              (left?.options?.priority ?? 0) - (right?.options?.priority ?? 0))
          } catch {
            return undefined
          }
        }
        /**
         * Does this entry declare the child slot our way-back row rides?
         *
         * `NativeMenuRow` lives in `conversation.input.model.options`, a list
         * child that only the ELECTED seat's own registration can declare (the
         * renderer mounts a slot's children from the winning entry). An entry
         * that never declared it cannot render our row, so stepping aside to it
         * is a one-way trip with no control that brings the panel back.
         * @param entry - a live StoredEntry.
         * @returns whether that entry can host the native-mode return row.
         */
        const declaresReturnRow = entry => {
          try {
            // A StoredEntry carries its declarations as `children`; accept the
            // raw registration shape too, so a Host that exposes the original
            // options object instead does not read as "declares nothing".
            const declared = entry?.children ?? entry?.options?.children
            if (declared === undefined || declared === null) return false
            return declared[NATIVE_MENU_SLOT] !== undefined
          } catch {
            return false
          }
        }
        /**
         * The entry that would inherit the seat if we stepped aside, or
         * undefined when handing the cell over is not actually safe.
         *
         * Deliberately does NOT require the shipped package name: a composed
         * profile may legitimately elect another plugin's seat. It DOES require
         * that the inheritor can host the return row — "some other entry is
         * there" is not the same promise as "the default style is there". A
         * third-party plugin that merely shadows the seat (the `dsh-acp-agents`
         * collision) has no such child slot, so switching to it would show a
         * foreign control and strand the user with no way back.
         * @returns the winning competing entry, when stepping aside is safe.
         */
        const nativeInheritor = () => {
          const others = otherEntries()
          if (others === undefined || others.length === 0) return undefined
          const winner = others[0]
          return declaresReturnRow(winner) ? winner : undefined
        }
        /**
         * May the panel hand the seat over?
         * @returns whether disposing this entry lands on the native picker.
         */
        const canStepAside = () => nativeInheritor() !== undefined
        /** Report the inheriting entry once, so a support log names the target. */
        let inheritReported = false
        const reportInherit = () => {
          if (inheritReported) return
          inheritReported = true
          try {
            const winner = nativeInheritor()
            const name = winner?.registrant ?? winner?.options?.id ?? 'no entry'
            console.info(`dsh-model-flatmap: the model seat is handed to ${name}`)
            // Name the blocker, not just the absence: "nothing underneath" and
            // "something underneath that is not the native picker" need very
            // different answers from the user.
            if (winner === undefined) {
              const others = otherEntries()
              const blocked = (others ?? []).map(entry => entry?.registrant ?? entry?.options?.id ?? 'unknown')
              if (blocked.length > 0) {
                console.warn('dsh-model-flatmap: the default style is unavailable because the entry underneath '
                  + `cannot host its return control (${blocked.join(', ')}) — another plugin is occupying the `
                  + 'model seat; disable it to get the native picker back')
              }
            }
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
            // The ONE visibility store: what Settings has switched off. The
            // panel filters its catalogue through it before grouping and
            // search, so a toggle flipped in Settings re-renders an open panel
            // without a reload.
            visibility: hiddenStore,
            // The ONE rename store: provider id -> display name. Same page-wide
            // store the Settings editor writes, so a rename re-labels an open
            // panel without a reload.
            aliases: aliasStore,
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
              // A face this broken must not hide anything: an empty record
              // shows the whole catalogue rather than an unexplained blank.
              visibility: ALL_VISIBLE,
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

        // ---- the Settings section: which providers and models are listed
        //
        // `settings.section` is the settings domain's own extension point: the
        // shell renders one page per registration, with our label in its nav
        // column. It is the right seat because the choice this page makes is a
        // preference about the composer's model list, not a property of the
        // plugin bundle — a bundle-config page would sit under Plugin Manager,
        // where nobody looks for "which models do I want to see".
        //
        // The section needs its OWN stable locale namespace (see SETTINGS_NS),
        // registered here rather than with the panel's dictionary. Both
        // registrations are independent: losing either costs one surface.
        try {
          const locale = read('locale')
          if (locale !== undefined && typeof locale.register === 'function') {
            ctx.effect(() => locale.register(SETTINGS_NS, settingsDict), 'dsh-model-flatmap: settings copy')
          }
        } catch (error) {
          console.error('dsh-model-flatmap: settings dictionaries were not registered', error)
        }

        try {
          ctx.effect(() => {
            if (typeof document === 'undefined') return
            return installSettingsNavIcon(document)
          }, 'dsh-model-flatmap: settings nav list icon')
        } catch (error) {
          console.error('dsh-model-flatmap: the settings nav icon was not installed', error)
        }

        try {
          if (typeof slots.inject === 'function') {
            slots.inject('settings.section', () => {
              if (typeof slots.register !== 'function') return () => {}
              try {
                // The nav label is a thunk over a BOUND translate: the settings
                // shell re-reads it on every projection and on every locale
                // revision, so a plain string would freeze the active language
                // at registration time.
                let bound
                const navLabel = () => {
                  try {
                    const locale = read('locale')
                    if (locale !== undefined && typeof locale.bind === 'function') {
                      bound ??= locale.bind(SETTINGS_NS)
                      const text = String(bound('nav'))
                      // A namespace whose registration was refused (or that a
                      // previous generation still holds) resolves every key to
                      // ITSELF. Printing "nav" in the nav column is worse than
                      // printing the English fallback, so the raw key is
                      // treated as "no translation".
                      if (text !== '' && text !== 'nav') return text
                    }
                  } catch {
                    /* fall through to the literal below */
                  }
                  return settingsDict.en.nav
                }
                return slots.register({
                  name: 'settings.section',
                  // An id of our own: a fresh id is added beside the shipped
                  // sections, while reusing a shipped one would replace it.
                  id: 'model-flatmap',
                  order: 100,
                  label: navLabel,
                  locale: SETTINGS_NS,
                  inject: () => ({
                    visibility: hiddenStore,
                    catalog: catalogStore,
                    telemetry: telemetryStore,
                    aliases: aliasStore,
                    // The badge text is catalog-authored and may be a
                    // translation map, so the section resolves it through the
                    // same host resolver the picker uses; without this the chip
                    // would print "[object Object]" for a localized badge.
                    resolveText,
                    // The SAME global balance store the panel reads. The section
                    // only draws from it, never writes: whether a route is out of
                    // credit is observed from the Sessions, not chosen here.
                    insufficient: markStore ?? EMPTY_INSUFFICIENT,
                  }),
                }, SettingsSection)
              } catch (error) {
                console.error('dsh-model-flatmap: the settings section was not registered', error)
                return () => {}
              }
            })
          }
        } catch (error) {
          // Losing the page costs the CONTROLS, never the picker: the panel
          // still works, and the hidden record is untouched.
          console.error('dsh-model-flatmap: slots.inject failed for the settings section', error)
        }
      },
    }
  },
})
