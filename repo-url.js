/**
 * Destination of the panel's "plugin marketplace" link.
 *
 * The button promotes the dsh.zuos.us plugin marketplace — the public catalogue
 * where this and sibling plugins are discovered and installed. Unlike the old
 * project link, this destination is NOT derived from the local checkout: it is
 * a fixed public site, so no git remote read, no Host route and no fallback
 * resolution is involved. One constant, shared with the browser half (which
 * repeats it because a client plugin cannot import a Host-only ESM module).
 *
 * @module dsh-model-flatmap/repo-url
 */

/**
 * The marketplace page the panel's link opens. Declared once, at the top, so it
 * is obviously the single source of truth; a test pins the browser half's copy
 * against it so the two cannot drift apart.
 */
export const MARKETPLACE_URL = 'https://dsh.zuos.us/'
