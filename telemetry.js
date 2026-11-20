/**
 * Anonymous daily heartbeat — the Host half's only side effect.
 *
 * The plugin itself is a Client-side UI replacement, so it has no natural
 * reason to touch the network. This module exists for exactly one question the
 * project could not answer before: **how many machines run this picker, and are
 * they still running it today?** npm download counts cannot answer that (CI,
 * mirrors and reinstalls all count), and a Client-side counter cannot either
 * (a browser tab that is never reloaded reports nothing).
 *
 * ## Three hard promises
 *
 * 1. **At most one request per machine per local day.** The state file records
 *    `lastAttemptDay`; a second start on the same day sends nothing. This is
 *    both the privacy stance ("no behavioural tracking") and the precondition
 *    for the server's idempotency.
 * 2. **The plugin never waits for it and never fails because of it.** The caller
 *    `void`s `start()`; every error inside is swallowed into at most one log
 *    line. A dead endpoint must cost the picker nothing.
 * 3. **What is sent is a fixed, seven-field fact, not a stream.** Installation
 *    id, plugin id, plugin version, platform, architecture, event kind and the
 *    protocol version — and unlike the sibling plugin's heartbeat there is not
 *    even a count field, because this plugin has no business event to count.
 *    The plugin id is what lets one endpoint serve several plugins.
 *    Never sent: prompts, session content, model names, file paths, provider
 *    URLs, usernames, IPs (the Worker does not read `CF-Connecting-IP` either).
 *    The installation id is a random UUIDv4 generated on first run and tied to no
 *    account; deleting `analytics.json` gives the machine a new identity.
 *
 * ## Where the state lives
 *
 * `$DSH_HOME/plugins/dsh-model-flatmap/` — inside the shared `plugins/` root every
 * DSH plugin keeps its runtime data in (DEC-059). Before that move the directory
 * sat directly under the home (`$DSH_HOME/dsh-model-flatmap/`), so
 * `migrateLegacyDataDir()` relocates it once on startup; see its comment for the
 * exact contract and for why a failure is a fallback rather than an error.
 *
 * ## Why the day boundary is fixed at UTC+8
 *
 * China has not used daylight saving since 1991, so `Asia/Shanghai` is a
 * constant UTC+8 and `(ms + 8h)` sliced to a calendar day is the local date —
 * no Intl, no time-zone database (which in Electron depends on how ICU is
 * packaged). The Worker computes the day the same way, so both sides agree.
 *
 * @module dsh-model-flatmap/telemetry
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/**
 * The collection endpoint. It is the same Worker that serves the sibling
 * plugin's statistics (`https://dsh.zuos.us/api/e`), and it routes records by
 * the payload's `p` field — that is why this module sends `p` and its own
 * daily digest exists per plugin without any server-side change.
 */
export const DEFAULT_ENDPOINT = 'https://dsh.zuos.us/api/e'

/**
 * State file name (inside the plugin's own data directory).
 *
 * Deliberately NOT `telemetry.json`: the sibling plugin keeps a local decision
 * ledger under that name, and two files one letter apart with entirely
 * different meanings eventually get deleted by the wrong person.
 */
export const STATE_FILE = 'analytics.json'

/**
 * The user's telemetry choice, persisted by the Settings toggle (DEC-035).
 *
 * The toggle lives in the browser, but the heartbeat sends from the Host, so
 * the choice has to be mirrored into a file this half can read before it
 * decides to send. The browser writes it through the Host's own
 * `/dsh-model-flatmap/telemetry-settings` route.
 *
 * Absent file means **enabled**: the collection is opt-OUT, so a machine whose
 * browser has never opened Settings keeps reporting exactly as before.
 */
export const SETTINGS_FILE = 'telemetry-settings.json'

/** Directory under the DSH home that holds this plugin's runtime data. */
export const DATA_DIR_NAME = 'dsh-model-flatmap'

/**
 * The shared root under the DSH home that every plugin keeps its runtime data
 * in (`$DSH_HOME/plugins/<plugin-name>/`, DEC-059).
 */
export const PLUGINS_DIR_NAME = 'plugins'

/** Environment variable the host itself honours for the DSH home directory. */
export const DSH_HOME_ENV = 'DSH_HOME'

/** Fixed UTC+8 offset (milliseconds); see the module comment. */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * Request budget. Measured against the live endpoint from this machine
 * (2026-11-14): a delivered heartbeat takes 4.6–6.9 s, because the Worker sits
 * behind a network whose TTFB alone is seconds. 5 s cut off roughly half of the
 * successful reports — the worst kind of failure, since it is indistinguishable
 * from "the user was offline" in the statistics. `AbortController` fires *just
 * after* headers, so the budget is about the whole exchange, not just TTFB, and
 * a smaller number cannot be compensated for elsewhere.
 */
const REQUEST_TIMEOUT_MS = 10000

/**
 * After this many consecutive failures the reporter gives up for good. An
 * endpoint that has been unreachable for a month is not coming back today, and
 * a request that is known to fail every launch is pure noise.
 */
const DEGRADE_AFTER_FAILURES = 30

/**
 * Expand a leading `~` (or `~/`, `~\`) to the user's home directory.
 *
 * Only the two forms that unambiguously mean "the current user's home" are
 * handled; `~alice/...` is returned unchanged rather than guessed at.
 *
 * @param {string} path - Possibly home-relative path.
 * @returns {string} The expanded path.
 */
export function expandHomePath(path) {
  const text = typeof path === 'string' ? path : ''
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2))
  return text
}

/**
 * Resolve the DSH home directory with the host's own rules: an explicitly
 * configured path, else `$DSH_HOME`, else `~/.dsh`.
 *
 * A blank or whitespace-only `$DSH_HOME` counts as unset — otherwise an empty
 * value would resolve the data directory to the current working directory.
 * The result is always absolute: a relative `$DSH_HOME=./home` would otherwise
 * make the state file move with the process's working directory.
 *
 * @param {{env?: Record<string, string|undefined>}} [options] - Injectable env for tests.
 * @returns {string} Absolute path of the DSH home.
 */
export function resolveDshHome(options = {}) {
  const env = options.env ?? process.env
  const raw = env?.[DSH_HOME_ENV]
  const fromEnv = typeof raw === 'string' && raw.trim().length > 0 ? raw : undefined
  return resolve(expandHomePath(fromEnv ?? join(homedir(), '.dsh')))
}

/**
 * The plugin's own data directory (`~/.dsh/plugins/dsh-model-flatmap/`).
 *
 * It lives inside the shared `plugins/` root every DSH plugin keeps its
 * runtime state in, rather than directly under the DSH home (DEC-059).
 *
 * @param {{env?: Record<string, string|undefined>}} [options] - Injectable env for tests.
 * @returns {string} Absolute directory path (not created here).
 */
export function resolveDataDir(options = {}) {
  return join(resolveDshHome(options), PLUGINS_DIR_NAME, DATA_DIR_NAME)
}

/**
 * The directory this plugin's data lived in before the `plugins/` move:
 * `~/.dsh/dsh-model-flatmap/` (DEC-059).
 *
 * Kept as a named function rather than an inline `join` because two places need
 * the exact same path — the one-shot migration and its fallback — and a typo in
 * either would silently strand a user's state file.
 *
 * @param {{env?: Record<string, string|undefined>}} [options] - Injectable env for tests.
 * @returns {string} Absolute legacy directory path.
 */
export function resolveLegacyDataDir(options = {}) {
  return join(resolveDshHome(options), DATA_DIR_NAME)
}

/**
 * The directory actually in force right now, without touching the disk beyond
 * two `stat` calls.
 *
 * Normally this is the current `plugins/` path. It is the legacy path only when
 * that directory still exists and the new one does not — i.e. the migration has
 * not run yet, or ran and failed. This is the fallback the whole module leans on:
 * a home directory the process cannot write to may cost the new location, never
 * the user's existing state.
 *
 * @param {{env?: Record<string, string|undefined>}} [options] - Injectable env for tests.
 * @returns {string} Absolute directory path (not created here).
 */
export function resolvePluginDataDir(options = {}) {
  const current = resolveDataDir(options)
  try {
    if (existsSync(current)) return current
    const legacy = resolveLegacyDataDir(options)
    if (existsSync(legacy)) return legacy
  } catch {
    /* An unreadable home is "nothing there yet"; the caller creates the path. */
  }
  return current
}

/**
 * Move the pre-`plugins/` data directory to its new home, once (DEC-059).
 *
 * The contract is deliberately narrow, because this runs on every start:
 *
 * - no legacy directory → do nothing, report `false` (a fresh install);
 * - the new directory already exists → **never overwrite and never merge**,
 *   report `false`. Merging two half-written state files would corrupt the
 *   installation id, and overwriting would throw away a newer copy;
 * - otherwise move the whole directory: `rename` first (atomic, same volume),
 *   and on `EXDEV` a recursive copy followed by deleting the source.
 *
 * **Never throws.** Every failure is swallowed and reported as `false`, which
 * makes the caller fall back to the legacy directory (`resolvePluginDataDir`)
 * and keeps the plugin working. Statistics are never worth a plugin fault.
 *
 * @param {{env?: Record<string, string|undefined>, fs?: object}} [options] -
 *   Injectable env and filesystem (`rename`, `cp`, `rm`) for tests.
 * @returns {Promise<boolean>} Whether a migration actually happened.
 */
export async function migrateLegacyDataDir(options = {}) {
  const legacy = resolveLegacyDataDir(options)
  const current = resolveDataDir(options)
  const fs = { rename, cp, rm, ...(options.fs ?? {}) }
  try {
    if (!(await pathExists(legacy))) return false
    // Both present means someone else already moved (or a newer release wrote
    // here first). Leave both exactly as they are and use the new one.
    if (await pathExists(current)) return false
    await mkdir(dirname(current), { recursive: true })
    try {
      await fs.rename(legacy, current)
      return true
    } catch (error) {
      // A different volume is the one failure a copy can still fix.
      if (error?.code !== 'EXDEV') throw error
    }
    try {
      // `errorOnExist` + `force: false`: a directory that appeared between the
      // check above and here is a reason to stop, not to write over it.
      await fs.cp(legacy, current, { recursive: true, errorOnExist: true, force: false })
    } catch (error) {
      // A target that appeared between the check above and the copy belongs to
      // someone else — never delete it, just fall back.
      //
      // A half-copied directory of our own is the opposite problem: it would
      // look "ready" to `resolvePluginDataDir`, so it has to go before we fall
      // back to the legacy directory.
      if (error?.code !== 'ERR_FS_CP_EEXIST') {
        await fs.rm(current, { recursive: true, force: true }).catch(() => {})
      }
      throw error
    }
    await fs.rm(legacy, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/**
 * Whether a path exists, treating any error (permissions included) as absent.
 *
 * @param {string} path - Absolute path.
 * @returns {Promise<boolean>} True when `stat` succeeds.
 */
async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Format a timestamp as the `Asia/Shanghai` calendar day.
 *
 * @param {number} ms - Milliseconds since the epoch.
 * @returns {string} `YYYY-MM-DD`, or an empty string for a non-numeric input.
 */
export function shanghaiDay(ms) {
  const value = Number(ms)
  if (!Number.isFinite(value)) return ''
  return new Date(value + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * Whether a value is a UUIDv4-shaped installation id. The Worker validates
 * with the same rule.
 *
 * @param {unknown} value - Candidate value.
 * @returns {boolean} True when valid.
 */
export function isValidInstallId(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

/**
 * Generate a fresh installation id (random UUIDv4, unrelated to any account or
 * machine fingerprint).
 *
 * @returns {string} The new id.
 */
export function newInstallId() {
  return randomUUID()
}

/**
 * Parse the state file. Any corruption degrades to "a brand-new install"
 * rather than throwing: when the statistics state is broken, reporting once
 * again is correct and never reporting again is not.
 *
 * @param {string} text - File contents, possibly empty or damaged.
 * @returns {object} Normalised state.
 */
export function parseState(text) {
  let raw = null
  try {
    raw = JSON.parse(String(text ?? ''))
  } catch {
    raw = null
  }
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const firstRun = Number(source.firstRunAt)
  return {
    installId: isValidInstallId(source.installId) ? source.installId : null,
    firstRunAt: Number.isFinite(firstRun) && firstRun > 0 ? firstRun : null,
    firstVersion: typeof source.firstVersion === 'string' ? source.firstVersion : '',
    lastSentDay: typeof source.lastSentDay === 'string' ? source.lastSentDay : '',
    lastAttemptDay: typeof source.lastAttemptDay === 'string' ? source.lastAttemptDay : '',
    lastOkDay: typeof source.lastOkDay === 'string' ? source.lastOkDay : '',
    failures: Number.isFinite(Number(source.failures)) ? Math.max(0, Number(source.failures)) : 0,
    degraded: source.degraded === true,
  }
}

/**
 * Serialise the state. Field order is fixed so the file stays readable by hand.
 *
 * @param {object} state - A `parseState`-shaped object.
 * @returns {string} JSON text with a trailing newline.
 */
export function serializeState(state) {
  return `${JSON.stringify({
    installId: state?.installId ?? null,
    firstRunAt: state?.firstRunAt ?? null,
    firstVersion: state?.firstVersion ?? '',
    lastSentDay: state?.lastSentDay ?? '',
    lastAttemptDay: state?.lastAttemptDay ?? '',
    lastOkDay: state?.lastOkDay ?? '',
    failures: state?.failures ?? 0,
    degraded: state?.degraded === true,
  }, null, 2)}\n`
}

/**
 * Parse the telemetry-settings file. Any corruption degrades to **enabled**:
 * the collection is opt-out, so an unreadable choice must never silently turn
 * reporting off — that would undercount by exactly the machines whose file got
 * damaged, which is the worst place to lose data.
 *
 * @param {string} text - File contents, possibly empty or damaged.
 * @returns {{enabled: boolean}} Normalised settings.
 */
export function parseSettings(text) {
  let raw = null
  try {
    raw = JSON.parse(String(text ?? ''))
  } catch {
    raw = null
  }
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return { enabled: source.enabled !== false }
}

/**
 * Serialise the telemetry settings. A single field, fixed order, hand-readable.
 *
 * @param {{enabled: boolean}} settings - A `parseSettings`-shaped object.
 * @returns {string} JSON text with a trailing newline.
 */
export function serializeSettings(settings) {
  return `${JSON.stringify({ enabled: settings?.enabled !== false }, null, 2)}\n`
}

/**
 * Read the telemetry settings from a data directory; a missing or damaged file
 * reads as **enabled** (opt-out, see `parseSettings`).
 *
 * @param {string} dir - The plugin's data directory.
 * @returns {Promise<{enabled: boolean}>} The current settings.
 */
export async function readSettingsFile(dir) {
  try {
    return parseSettings(await readFile(join(dir, SETTINGS_FILE), 'utf8'))
  } catch {
    return parseSettings('')
  }
}

/**
 * Write the telemetry settings atomically (temp file then rename), 0600 like
 * the state file: not secret, but nothing about a local choice should be
 * world-readable.
 *
 * @param {string} dir - The plugin's data directory (created if missing).
 * @param {{enabled: boolean}} settings - The settings to persist.
 * @returns {Promise<void>} Resolves when the rename is done.
 */
export async function writeSettingsFile(dir, settings) {
  await mkdir(dir, { recursive: true })
  const target = join(dir, SETTINGS_FILE)
  const tmp = `${target}.tmp`
  await writeFile(tmp, serializeSettings(settings), { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, target)
}

/**
 * Decide whether this start reports, and as what. Pure function; the tests'
 * main entry point.
 *
 * @param {object} state - Current state (`parseState` shape).
 * @param {{today?: string}} [options] - Local day `YYYY-MM-DD`.
 * @returns {'install'|'heartbeat'|null} `null` means "send nothing".
 */
export function decideKind(state, options = {}) {
  const { today } = options
  if (typeof today !== 'string' || today.length === 0) return null
  if (state?.degraded === true) return null
  // The single enforcement point for "at most one attempt per local day".
  if (state?.lastAttemptDay === today) return null
  const fresh = !isValidInstallId(state?.installId) || !Number.isFinite(Number(state?.firstRunAt))
  return fresh ? 'install' : 'heartbeat'
}

/**
 * Clean a version string: printable version characters only, capped in length.
 *
 * @param {unknown} value - Raw value.
 * @returns {string} Cleaned value, possibly empty.
 */
export function normalizeVersion(value) {
  return String(value ?? '').trim().replace(/[^0-9A-Za-z._+-]/g, '').slice(0, 32)
}

/** Shared cleaning for short identity fields (platform, architecture). */
function shortField(value, max = 24) {
  return String(value ?? '').trim().replace(/[^0-9A-Za-z._+-]/g, '').slice(0, max)
}

/**
 * Normalise a plugin id (npm package-name shape): lowercase, letters, digits
 * and `-` / `.` / `_`, at most 48 characters.
 *
 * The payload must name its sender: one collection endpoint serves several
 * plugins, and a record that cannot be attributed is worse than a missing one.
 *
 * @param {unknown} value - Raw value (normally `package.json`'s `name`).
 * @returns {string} A valid plugin id, or an empty string when invalid.
 */
export function normalizePluginId(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9._-]{0,47}$/.test(text) ? text : ''
}

/**
 * Build the request body. Short keys on purpose: there is no room in this shape
 * for a prompt, a path or a session — the schema itself is the privacy bound.
 *
 * @param {object} input - Field values.
 * @param {string} input.pluginId - This plugin's npm package name (required).
 * @param {string} input.installId - Installation id.
 * @param {'install'|'heartbeat'} input.kind - Event kind.
 * @param {string} input.version - Plugin version.
 * @param {string} input.platform - `process.platform`.
 * @param {string} input.arch - `process.arch`.
 * @param {string} [input.hostVersion] - Host version; omitted when unknown.
 * @returns {object} A `JSON.stringify`-ready object.
 */
export function buildPayload(input = {}) {
  const payload = {
    v: 1,
    // `p` = plugin: who is reporting. `prepare` refuses to send without it.
    p: normalizePluginId(input.pluginId),
    id: input.installId,
    k: input.kind,
    ver: normalizeVersion(input.version) || 'unknown',
    os: shortField(input.platform),
    arch: shortField(input.arch),
  }
  const host = normalizeVersion(input.hostVersion)
  if (host.length > 0) payload.host = host
  return payload
}

/**
 * Validate and normalise an endpoint. Only http/https are accepted; anything
 * else falls back to the default rather than sending a heartbeat somewhere odd.
 *
 * @param {unknown} raw - Configured value.
 * @returns {string} A full URL.
 */
export function resolveEndpoint(raw) {
  const text = String(raw ?? '').trim()
  if (text.length === 0) return DEFAULT_ENDPOINT
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_ENDPOINT
    return url.href
  } catch {
    return DEFAULT_ENDPOINT
  }
}

/**
 * The reporter. All side effects live here and happen once per `start()`.
 *
 * `dir`, `logger`, `fetchImpl` and `clock` are injectable, so the tests exercise
 * the whole state machine with no network, no real clock and a temp directory.
 */
export class TelemetryReporter {
  #dir
  #logger
  #endpoint
  #pluginId
  #fetchImpl
  #clock
  #enabled
  #warned = false

  /**
   * @param {{dir?: string, logger?: object, endpoint?: string, pluginId?: string,
   *   fetchImpl?: Function, clock?: Function, enabled?: boolean}} [options] - Dependencies.
   *
   * `enabled: false` is the Settings toggle's off position (DEC-035): the
   * reporter stays fully constructed but sends nothing and writes no state, so
   * re-enabling tomorrow reports a fresh `install`/`heartbeat` cleanly.
   */
  constructor(options = {}) {
    this.#dir = options.dir ?? '.'
    this.#logger = options.logger
    this.#endpoint = resolveEndpoint(options.endpoint)
    this.#pluginId = normalizePluginId(options.pluginId)
    this.#fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.#clock = typeof options.clock === 'function' ? options.clock : () => Date.now()
    this.#enabled = options.enabled !== false
  }

  /** The endpoint in force (visible in a log line when troubleshooting). */
  get endpoint() {
    return this.#endpoint
  }

  /** The plugin id being reported; empty means "misconfigured, do not send". */
  get pluginId() {
    return this.#pluginId
  }

  /** Whether the Settings toggle currently allows reporting (DEC-035). */
  get enabled() {
    return this.#enabled
  }

  /** Absolute path of the state file (users inspect this file directly). */
  get statePath() {
    return join(this.#dir, STATE_FILE)
  }

  /**
   * Read the state file; a missing or damaged file reads as "new install".
   * Read-only: this never creates the file.
   *
   * @returns {Promise<object>} State object.
   */
  async readState() {
    try {
      return parseState(await readFile(this.statePath, 'utf8'))
    } catch {
      return parseState('')
    }
  }

  /**
   * Write the state atomically: temp file then rename, so a kill mid-write
   * cannot leave half a JSON file behind.
   *
   * @param {object} state - Complete state.
   * @returns {Promise<void>} Resolves when the rename is done.
   */
  async writeState(state) {
    await mkdir(this.#dir, { recursive: true })
    const tmp = `${this.statePath}.tmp`
    await writeFile(tmp, serializeState(state), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, this.statePath)
  }

  /**
   * Compute what this start would send, without sending or writing anything —
   * used by `start()` and available for dry runs.
   *
   * @param {object} input - `version`, `platform`, `arch`, `hostVersion`.
   * @returns {Promise<{state: object, payload: object, today: string, kind: string}|null>}
   *   `null` when nothing should be sent.
   */
  async prepare(input = {}) {
    // The Settings toggle (DEC-035). Checked first and silently: an opted-out
    // machine reports nothing and records no attempt, so re-enabling starts a
    // clean day rather than resuming a half-written one.
    if (this.#enabled !== true) return null
    // No valid plugin id → no request. A record that cannot be attributed is
    // the one kind of dirty data that is expensive to clean up later.
    if (this.#pluginId.length === 0) return null
    const now = this.#clock()
    const today = shanghaiDay(now)
    if (today.length === 0) return null
    const state = await this.readState()
    const kind = decideKind(state, { today })
    if (kind === null) return null

    const installId = state.installId ?? newInstallId()
    const next = {
      ...state,
      installId,
      firstRunAt: state.firstRunAt ?? now,
      firstVersion: state.firstVersion.length > 0 ? state.firstVersion : normalizeVersion(input.version),
      lastAttemptDay: today,
    }
    const payload = buildPayload({
      pluginId: this.#pluginId,
      installId,
      kind,
      version: input.version,
      platform: input.platform,
      arch: input.arch,
      hostVersion: input.hostVersion,
    })
    return { state: next, payload, today, kind }
  }

  /**
   * Run one heartbeat. **Never throws**: every failure becomes a warning and is
   * left for tomorrow's start.
   *
   * @param {object} input - Same as `prepare`.
   * @returns {Promise<{sent: boolean, kind: string|null, reason: string}>}
   *   A result object, convenient for tests and logs.
   */
  async start(input = {}) {
    let prepared = null
    try {
      prepared = await this.prepare(input)
    } catch (error) {
      this.#warn(`statistics state could not be read (plugin unaffected): ${String(error?.message ?? error)}`)
      return { sent: false, kind: null, reason: 'state-error' }
    }
    if (prepared === null) return { sent: false, kind: null, reason: 'not-due' }

    const { state, payload, today } = prepared

    // Write the state BEFORE sending: if the process dies mid-request, the day
    // is still marked as attempted, so a crash cannot become a report loop. The
    // cost is that a failed day is not retried — the next start is tomorrow.
    //
    // A failed write is a **hard stop**, not a warning: without the attempt on
    // disk there is nothing to stop the next start from sending again, and
    // "every launch of a read-only profile reports a heartbeat" both breaks the
    // once-a-day promise and inflates DAU. Losing one heartbeat is the cheaper
    // of the two failures.
    try {
      await this.writeState(state)
    } catch (error) {
      this.#warn(`statistics state could not be written, so nothing was sent (plugin unaffected): ${String(error?.message ?? error)}`)
      return { sent: false, kind: null, reason: 'state-error' }
    }

    const sent = await this.#post(payload)
    try {
      await this.writeState({
        ...state,
        lastSentDay: sent ? today : state.lastSentDay,
        lastOkDay: sent ? today : state.lastOkDay,
        failures: sent ? 0 : state.failures + 1,
        degraded: sent ? false : state.failures + 1 >= DEGRADE_AFTER_FAILURES,
      })
    } catch {
      /* A second write failure only affects the next retry; not worth a warning. */
    }
    if (!sent) this.#warn(`heartbeat not delivered (endpoint ${this.#endpoint}); will retry on a later launch`)
    return { sent, kind: payload.k, reason: sent ? 'ok' : 'http-failed' }
  }

  /**
   * Perform the request; true only for a 2xx. Timeouts and network errors all
   * mean "this one did not land".
   *
   * @param {object} payload - Request body.
   * @returns {Promise<boolean>} Whether the endpoint accepted it.
   */
  async #post(payload) {
    const fetchImpl = this.#fetchImpl
    if (typeof fetchImpl !== 'function') return false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetchImpl(this.#endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      return Boolean(response?.ok)
    } catch {
      // Offline, blocked, endpoint down: this heartbeat did not land, nothing else.
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  /** One warning per process, so a dead endpoint cannot flood the log. */
  #warn(message) {
    if (this.#warned) return
    this.#warned = true
    this.#logger?.warn?.(`dsh-model-flatmap: ${message}`)
  }
}
