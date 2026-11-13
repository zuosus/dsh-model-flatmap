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
.dshmf-triggerEffort { flex-shrink: 1000; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-caption); }
.dshmf-chevron { flex: 0 0 auto; color: var(--dsw-alias-label-caption); transition: transform 120ms ease; }
.dshmf-chevronOpen { transform: rotate(180deg); }

/* Panel: the host menu surface (menu fill + blur + prominent elevation + lg
   corners), capped at 320px; only the grid scrolls. */
.dshmf-panel {
  box-sizing: border-box; position: fixed; z-index: 1100;
  display: flex; flex-direction: column; gap: 4px; padding: 6px;
  max-height: 320px; overflow: hidden;
  border: 0; border-radius: var(--dsw-radius-lg);
  background: var(--dsw-menu-surface-fill);
  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

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

/* The only scrolling region. */
.dshmf-grid { flex: 1 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto; display: grid; align-items: start; }
.dshmf-col { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
/* When more than one column is laid out, separate adjacent columns with a
   faint vertical hairline so the eye can tell the dense model flows apart.
   The line uses the lightest border token to stay subtle, and the divided
   column keeps a little right padding so model text never hugs the line.
   Only columns that actually sit before another one get it (see renderColumn),
   so a single-column layout stays borderless. */
.dshmf-col--divided { border-right: 1px solid var(--dsw-alias-border-l3); padding-right: 10px; }
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
  align-self: flex-start; max-width: 100%;
  box-sizing: border-box; height: 20px; padding: 0 8px 0 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border: 1px solid var(--dsw-alias-border-l2);
  border-left: 3px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-bg-overlay);
  box-shadow: var(--dsw-elevation-soft);
  color: var(--dsw-alias-label-primary);
  font-size: 10px; line-height: 18px; font-weight: 700; letter-spacing: .02em;
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
.dshmf-rowName { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* A multiplier marker lifted out of the model name (rate/size tags like
   "x0.01", "x1.5", "X 2.2"). The characters stay in place and the full name is
   unchanged; only this run is drawn two sizes smaller and bold, so the
   multiplier reads as an aside without disturbing the row's text rhythm
   (see renderRow's nameRuns). */
.dshmf-rowNameMark { font-size: 11px; line-height: 18px; font-weight: 700; letter-spacing: normal; }
/* Provider tag inside a family-grouped row: the same family spans several
   providers, so each row says where it comes from. Quieter than the model name
   (caption colour, 11px) and shrinks before the name does, because the model
   name is what identifies the row. No width cap: a cap truncates a perfectly
   readable provider label ("CodeBuddy …") in a column that had room for it. */
.dshmf-rowProvider {
  flex: 0 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-caption);
  font-size: 11px; line-height: 16px; font-weight: 400;
}
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

/* Reasoning levels: a caption and a multi-segmentation control on one line;
   the track wraps below the caption only when the row cannot fit. The
   segment visual mirrors the header's grouping control, so the panel has
   one visual language for "one of many, exactly one active". */
.dshmf-reason {
  flex: 0 0 auto; display: flex; align-items: center; flex-wrap: wrap;
  gap: 2px 6px;
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
  min-height: 30px; padding: 0 6px; margin-top: 1px;
  border-top: 0.5px solid var(--dsw-alias-border-l1);
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

    const PATH_CHEVRON = 'M3.2 5.6 7 9.4 10.8 5.6'
    const PATH_CLOSE = 'M4 4 10 10M10 4 4 10'
    const PATH_INFO = 'M7 6.4v4.1M7 3.7v.8'
    const PATH_SPARK = 'M7 1.6 8.3 5.7 12.4 7 8.3 8.3 7 12.4 5.7 8.3 1.6 7 5.7 5.7 7 1.6Z'
    const PATH_MODELS = 'M7 2.1 11.9 4.7 7 7.3 2.1 4.7 7 2.1Zm-4.9 5.1L7 9.8l4.9-2.6M2.1 10.3 7 12.9l4.9-2.6'

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
    // Families stay flat; Others always sorts last. A family is a BRAND, not a
    // version: `hy3`, `hy4-preview` and `hy4free` are one `HY` family, not
    // three, so a version tail never splits a heading.
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
     * A brand token followed by a version tail: `hy3`, `hy4-preview`,
     * `hy4free`, `qwen2.5`. The family is the brand; the tail is a version,
     * and a version must never split one brand into several headings —
     * `hy3` and `hy4free` are the same family.
     */
    const BRAND_WITH_VERSION = /^([a-z][a-z]*?)(\d[\w.-]*)$/i
    /**
     * Brands the versioned rule has to own, mapped to the exact heading they
     * draw. They sort with the dictionary families instead of after them.
     * `HY` is the case that prompted this: its ids (`hy3`, `hy4-preview`,
     * `hy4free`) share no name needle, and the brand is an acronym, so the
     * generic title-casing would draw it as `Hy`.
     */
    const FAMILY_BRANDS = new Map([['hy', 'HY']])
    const FAMILY_ORDER = [
      ...FAMILY_DICTIONARY.map(entry => entry[0]),
      ...FAMILY_BRANDS.values(),
    ]

    /**
     * The brand part of one versioned id token, or '' when the token carries
     * no version tail.
     * @param {string} token - one lowercased id segment.
     * @returns {string} the lowercased brand, or ''.
     */
    function brandOf(token) {
      const hit = BRAND_WITH_VERSION.exec(token)
      if (hit === null) return ''
      const brand = hit[1]
      return brand.length < 2 ? '' : brand
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
      // brand with its provider (`codebuddy-hy3`) still lands in `HY`, and a
      // bare brand id (`hy`) does not fall through to the generic casing.
      const segments = String(model.id).split(/[/:]/).pop().split(/[-_.]/).filter(Boolean)
      if (segments.length === 0) return OTHERS
      for (const segment of segments) {
        const lower = segment.toLowerCase()
        const known = FAMILY_BRANDS.get(lower) ?? FAMILY_BRANDS.get(brandOf(lower))
        if (known !== undefined) return known
      }
      const token = segments[0].toLowerCase()
      if (token.length < 2 || VERSION_ONLY.test(token)) return OTHERS
      const alias = FAMILY_ALIASES.get(token)
      if (alias !== undefined) return alias
      // A versioned segment collapses onto its brand, so `acme4-turbo` and
      // `acme-7b` share one heading instead of two.
      const brand = brandOf(token)
      const stem = brand === '' ? token : brand
      return stem.charAt(0).toUpperCase() + stem.slice(1)
    }

    function familyRank(family) {
      if (family === OTHERS) return Number.MAX_SAFE_INTEGER
      const known = FAMILY_ORDER.indexOf(family)
      return known === -1 ? FAMILY_ORDER.length : known
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

      const [open, setOpen] = useState(false)
      const [query, setQuery] = useState('')
      const [grouping, setGrouping] = useState('provider')
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
      const teamErrorRef = useRef(null)
      const confirmRef = useRef(null)
      const id = useId()

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
        const providerLabelOf = group => {
          if (group.id === 'deepseek-account') return t('provider.account')
          const resolved = resolveText === undefined ? undefined : resolveText(group.name)
          if (typeof resolved === 'string' && resolved.trim() !== '') return resolved
          const fallback = fallbackText(group.name)
          return fallback.trim() === '' ? group.id : fallback
        }
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

      // ---- measurement: probe metrics + fixed-section heights
      useLayoutEffect(() => {
        if (!open) return
        const rowH = probeRowRef.current?.getBoundingClientRect().height ?? 26
        const headH = probeHeadRef.current?.getBoundingClientRect().height ?? 20
        const heights = [headRef, errorRef, reasonRef, confirmRef, teamErrorRef, teamRef]
          .map(ref => ref.current?.offsetHeight ?? 0)
          .filter(height => height > 0)
        const fixed = heights.reduce((sum, height) => sum + height, 0)
        const fixedCount = heights.length
        setMetrics(previous => (previous.rowH === rowH && previous.headH === headH
          && previous.fixed === fixed && previous.fixedCount === fixedCount
          ? previous
          : { ...previous, rowH, headH, fixed, fixedCount }))
      })

      // ---- placement: above the trigger, kept inside the viewport
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
      })

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
        const { model, providerId, providerLabel } = entry
        const selected = state.current?.provider === providerId && state.current.model === model.id
        const pendingThis = state.pending?.provider === providerId && state.pending.model === model.id
        const badge = badgeOf(model)
        /**
         * In family grouping a heading says what the models ARE, not where
         * they come from — the same family can hold models from several
         * providers — so each row names its own provider. In provider grouping
         * the heading already is the provider, and repeating it per row would
         * be pure noise.
         */
        const showProvider = grouping === 'family'
          && typeof providerLabel === 'string' && providerLabel !== ''
        const rowTitle = model.description === undefined
          ? model.name
          : `${model.name}\n${model.description}`
        return h('button', {
          key: `${providerId}/${model.id}`,
          type: 'button',
          className: 'dshmf-row',
          'aria-pressed': selected,
          title: showProvider ? `${rowTitle}\n${providerLabel}` : rowTitle,
          disabled: busy,
          onClick: () => { chooseModel(providerId, model) },
        },
          h('span', { className: 'dshmf-rowName' }, ...nameRuns(model.name)),
          showProvider ? h('span', {
            className: 'dshmf-rowProvider',
            title: providerLabel,
          }, providerLabel) : null,
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

      const renderBlock = block => (block.kind === 'title'
        ? h('div', {
          className: 'dshmf-groupTitle',
          key: block.key,
          title: block.label,
        }, block.label)
        : renderRow(block.entry))

      const renderColumn = (column, columnIndex) => h('div', {
        className: 'dshmf-col' + (plan.count > 1 && columnIndex < plan.count - 1 ? ' dshmf-col--divided' : ''),
        key: `col-${columnIndex}`,
      }, column.map(unit => unit.blocks.map(renderBlock)))

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
            setOpen(true)
          },
        },
          svg(PATH_MODELS, 16, { className: 'dshmf-triggerIcon' }),
          h('span', { className: 'dshmf-triggerText' }, modelLabel),
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
                  onClick: () => { setGrouping('provider') },
                }, t('group.provider')),
                h('button', {
                  type: 'button',
                  className: 'dshmf-segBtn',
                  'aria-pressed': grouping === 'family',
                  title: t('group.family'),
                  onClick: () => { setGrouping('family') },
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
                gridTemplateColumns: `repeat(${plan.count}, minmax(0, 1fr))`,
                columnGap: `${COL_GAP}px`,
              },
            },
              showEmptyState
                ? h('div', { className: 'dshmf-empty', role: 'status' }, t(emptyKey))
                : plan.columns.map(renderColumn),
              state.failures.length === 0 ? null : state.failures.map(renderFailure),
            ),

            // ---- fixed: reasoning levels of the current model, rendered as
            // one labelled group of mutually exclusive choices
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

            // ---- fixed, bottom: the agent teamwork switch. `teamAvailable`
            // is evaluated per render because the remote scope may bind late.
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

            // ---- measurement probe (never painted). It mirrors a family-
            // grouped row (name + provider tag), the widest row shape, so the
            // measured row height covers every mode. It carries no trailing
            // tail: the selected row no longer reserves one.
            h('div', { className: 'dshmf-probe', 'aria-hidden': 'true' },
              h('div', { ref: probeHeadRef, className: 'dshmf-groupTitle' }, 'X'),
              h('div', { ref: probeRowRef, className: 'dshmf-row' },
                h('span', { className: 'dshmf-rowName' }, 'X'),
                h('span', { className: 'dshmf-rowProvider' }, 'X'),
              ),
            ),
          ),
          document.body,
        ) : null,
      )
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
      inject: ['slots', 'locale', 'remote', 'remote.agentTeams'],
      // Pure layout and grouping derivations plus the component itself,
      // exposed for `node --test` so grouping, filtering and the column
      // algorithm are pinned without a browser. The shell never reads this key.
      __test: { familyOf, familyRank, matchScore, providerScore, searchTokens, buildUnits, columnHeight, packColumns, planColumns },
      __component: ModelFlatMap,
      __seat: Seat,
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
          return {
            sessionId,
            resolveDirectory: resolve,
            safeRead,
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

        try {
          slots.inject('conversation.input.model', registerSeat)
        } catch (error) {
          console.error('dsh-model-flatmap: slots.inject failed for the model seat', error)
        }
      },
    }
  },
})
