/**
 * Host half of the flat model picker bundle.
 *
 * The plugin is client-side and runs in both the Web GUI and the Desktop app: it
 * replaces the composer's `conversation.input.model` seat with a flat panel rendered
 * in the client UI, and reads the Session's model directory, projections and
 * `session.selectModel` through public Client APIs.
 *
 * The Host contributes no service, tool or event. It has exactly one job of its
 * own: the anonymous daily heartbeat in `telemetry.js` (see DEC-031), which is
 * how the project can tell how many machines actually run the picker and how
 * many of them ran it today. npm downloads cannot answer that (CI, mirrors and
 * reinstalls all count) and a Client-side counter cannot either (a tab that is
 * never reloaded reports nothing).
 *
 * Two rules keep that job from ever becoming the Host's problem:
 *
 * 1. It runs inside `void` — it is a bypass, never on any startup path, and the
 *    picker's UI is already live before the request is even built.
 * 2. Every failure is swallowed into at most one log line. A dead endpoint, a
 *    read-only home directory or a missing `crypto` must cost the plugin
 *    nothing; statistics failing can never be a plugin fault.
 */
import { readFileSync } from 'node:fs'

import { TelemetryReporter, resolveDataDir } from './telemetry.js'

export const name = 'dsh-model-flatmap'
export const inject = []

/**
 * How often a still-running Host re-checks whether today's heartbeat is done.
 *
 * Report-on-start alone undercounts the one case that matters most for DAU: the
 * Desktop app (or a long-lived Web Host) that is simply left open. A process
 * that started at 09:00 yesterday and is still up at 09:00 today would report
 * once, for yesterday, and be absent from today's number — an undercount that
 * looks exactly like "the user stopped using it".
 *
 * The re-check is cheap and idempotent: the state file's `lastAttemptDay`
 * answers "already done today" without any network I/O, so only the first check
 * after midnight actually sends anything. Six hours bounds how stale an answer
 * can get while keeping the timer trivially cheap.
 */
export const RECHECK_MS = 6 * 60 * 60 * 1000

/**
 * Set once per process. The reporter warns once per instance, which was enough
 * when it ran once per launch; with a re-check timer the same condition would
 * otherwise repeat four times a day.
 */
let warned = false

/** Log at most one statistics warning per process; the plugin must stay quiet. */
function warnOnce(ctx, message) {
  if (warned) return
  warned = true
  try {
    ctx?.logger?.warn?.(message)
  } catch {
    /* a broken logger is not worth a crash */
  }
}

/**
 * Read this package's manifest.
 *
 * Why not `import ... with { type: 'json' }`: the plugin supports Node versions
 * from before import attributes stabilised, where that is a syntax error, while
 * `package.json` is always shipped (it is in `files`). A failure returns an
 * empty object so a missing manifest costs a version label, not a plugin.
 *
 * @returns {object} Parsed manifest, or `{}`.
 */
function readOwnPackage() {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) ?? {}
  } catch {
    return {}
  }
}

/**
 * Send this machine's daily heartbeat, if it has not been sent today.
 *
 * Deliberately not configurable: the plugin ships no settings page, and a
 * switch nobody can reach is worse than none — it would only let the default
 * look like a user choice. What bounds the request instead is its own shape:
 * seven fields, no free text, no session content (see `telemetry.js`), and at
 * most one request per machine per local day.
 *
 * @param {object} ctx - The Host plugin context, used only for its logger.
 * @returns {Promise<{sent: boolean, kind: string|null, reason: string}|null>}
 *   The reporter's result, or `null` when reporting could not even be set up.
 */
async function heartbeat(ctx) {
  const pkg = readOwnPackage()
  try {
    return await new TelemetryReporter({
      dir: resolveDataDir(),
      logger: ctx?.logger,
      // Both values come from the manifest rather than constants: a fork that
      // renames the package must land on its own statistics line, not merge
      // into this one.
      pluginId: typeof pkg.name === 'string' ? pkg.name : '',
    }).start({
      version: typeof pkg.version === 'string' ? pkg.version : '',
      platform: process.platform,
      arch: process.arch,
      // The Host version is not reliably reachable from a plugin, and a
      // guessed value would be worse than an absent one: the payload omits it.
      hostVersion: '',
    })
  } catch (error) {
    // Setup failures (no writable home, no crypto, no fetch) are not the
    // plugin's business either. The reporter has its own warning budget; this
    // guards the construction itself.
    warnOnce(ctx, `dsh-model-flatmap: heartbeat was not started (plugin unaffected): ${String(error?.message ?? error)}`)
    return null
  }
}

/**
 * Keep today's heartbeat honest while the process stays up.
 *
 * `unref()` is the important half: the timer must never be a reason for the
 * process to stay alive. In a CLI Host that finishes a command and exits, the
 * timer simply dies with it; in the Desktop app it keeps the daily number
 * correct across midnight.
 *
 * @param {object} ctx - The Host plugin context.
 * @returns {Function} A disposer that clears the timer.
 */
function scheduleRechecks(ctx) {
  const timer = setInterval(() => {
    // Never let a re-check throw out of a timer callback: an unhandled
    // rejection there takes the whole process down.
    heartbeat(ctx).catch((error) => {
      warnOnce(ctx, `dsh-model-flatmap: heartbeat re-check failed (plugin unaffected): ${String(error?.message ?? error)}`)
    })
  }, RECHECK_MS)
  // Do not hold the event loop open.
  if (typeof timer.unref === 'function') timer.unref()
  return () => clearInterval(timer)
}

export function apply(ctx) {
  // `void`, never awaited: the first run of a new install really does send a
  // request, and the composer must not wait for it.
  void heartbeat(ctx).catch(() => {})

  // A process that outlives midnight reports again the day it is still running
  // (see RECHECK_MS). Registering the disposer through `ctx.effect` keeps the
  // timer owned by the plugin's lifecycle instead of leaking past a disable.
  try {
    const dispose = scheduleRechecks(ctx)
    if (typeof ctx?.effect === 'function') ctx.effect(() => dispose)
  } catch (error) {
    // No timer only costs the across-midnight case, never the launch heartbeat.
    warnOnce(ctx, `dsh-model-flatmap: heartbeat re-check was not scheduled (plugin unaffected): ${String(error?.message ?? error)}`)
  }
}
