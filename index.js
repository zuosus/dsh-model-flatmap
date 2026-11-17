/**
 * Host half of the flat model picker bundle.
 *
 * The plugin is client-side and runs in both the Web GUI and the Desktop app: it
 * replaces the composer's `conversation.input.model` seat with a flat panel rendered
 * in the client UI, and reads the Session's model directory, projections and
 * `session.selectModel` through public Client APIs.
 *
 * The Host contributes no service, tool or event. It has exactly three jobs of
 * its own:
 *
 * 1. The anonymous daily heartbeat in `telemetry.js` (see DEC-031), which is
 *    how the project can tell how many machines actually run the picker and how
 *    many of them ran it today. npm downloads cannot answer that (CI, mirrors
 *    and reinstalls all count) and a Client-side counter cannot either (a tab
 *    that is never reloaded reports nothing). The user can switch it off in
 *    Settings (see DEC-035); the Host honours that choice on every send.
 * 2. One read-only route answering the panel's "open the project page" button
 *    with the URL its checkout configures (see `repo-url.js`). The browser half
 *    has no filesystem and no subprocess, so the checkout can only be read
 *    here. The route resolves on EVERY request rather than at activation: a
 *    remote added while the Host is running is picked up by the next click,
 *    and a checkout that is not a repository yet can become one.
 * 3. One telemetry-settings route the Settings toggle mirrors its choice
 *    through (see DEC-035). The toggle lives in the browser, the send happens
 *    here, so the browser writes its choice to a file this half reads before
 *    every send.
 *
 * Two rules keep those jobs from ever becoming the Host's problem:
 *
 * 1. Both run off any startup path — the heartbeat inside `void`, the route
 *    only when the button is pressed — so the picker's UI is live before
 *    either does anything.
 * 2. Every failure is swallowed into at most one log line, or into the
 *    documented fallback. A dead endpoint, a read-only home directory, a
 *    missing `crypto` or a checkout with no GitHub remote must cost the plugin
 *    nothing; neither statistics nor a link can ever be a plugin fault.
 */
import { readFileSync } from 'node:fs'

import { FALLBACK_PROJECT_URL, resolveProjectUrl } from './repo-url.js'
import {
  TelemetryReporter,
  readSettingsFile,
  resolveDataDir,
  writeSettingsFile,
} from './telemetry.js'

export const name = 'dsh-model-flatmap'

/**
 * Services the Host half reads, all optional at call time.
 *
 * `webServer` carries the read-only project-link route; `connection` supplies
 * the trust fence that route is checked against. Neither is required for the
 * picker itself, so a composition without them still loads: the route is then
 * simply not registered, and the button falls back to {@link FALLBACK_PROJECT_URL}.
 */
export const inject = []

/**
 * Path of the read-only route answering the panel's project-link button.
 *
 * Namespaced under the package name so it cannot collide with another plugin's
 * route, and document-relative when the browser fetches it, like every other
 * app-owned route. It deliberately does NOT live under `/api`: that prefix is
 * the Connection carrier's, and a route there would have to reproduce its
 * envelope instead of returning plain JSON.
 */
export const PROJECT_LINK_PATH = '/dsh-model-flatmap/project-link'

/**
 * Path of the telemetry-settings route the Settings toggle talks to (DEC-035).
 *
 * The toggle lives in the browser, but the heartbeat sends from here, so the
 * browser mirrors its choice into a file this half reads before every send.
 * `GET` answers the current choice; `POST` writes a new one. Namespaced under
 * the package name like {@link PROJECT_LINK_PATH}, and behind the same trust
 * fence — without it any web page could flip this machine's reporting.
 */
export const TELEMETRY_SETTINGS_PATH = '/dsh-model-flatmap/telemetry-settings'

/**
 * Answer one project-link read.
 *
 * The URL is resolved per request, so the answer always reflects the checkout
 * as it is now. A failure inside the resolution is answered with the fallback
 * rather than an error status: the button's job is to have somewhere to go, and
 * a 500 would leave it dead for a reason the user cannot act on.
 *
 * @returns {Promise<{url: string, source: 'remote'|'fallback', remote?: string}>}
 *   The page URL and where it came from.
 */
async function projectLinkPayload() {
  try {
    return await resolveProjectUrl()
  } catch {
    return { url: FALLBACK_PROJECT_URL, source: 'fallback' }
  }
}

/**
 * Register the read-only project-link route.
 *
 * Registration is best-effort by design: a composition without a web server
 * (the Desktop app serves its own files) must still load the picker, so a
 * missing service or a rejected registration costs the link, never the plugin.
 *
 * @param {object} ctx - the Host plugin context.
 * @returns {void}
 */
function registerProjectLink(ctx) {
  let webServer
  try {
    webServer = typeof ctx?.get === 'function' ? ctx.get('webServer') : undefined
  } catch {
    webServer = undefined
  }
  if (webServer === undefined || typeof webServer.register !== 'function') return

  try {
    const register = () => webServer.register({
      kind: 'exact',
      path: PROJECT_LINK_PATH,
      handler: async (req, res) => {
        // The route answers the Host/Origin fence and an authenticated Peer
        // exactly as the shipped plugins' own routes do. Without the fence a
        // page on any origin could read this machine's checkout details.
        const rejection = trustRejection(ctx, req)
        if (rejection !== undefined) {
          res.statusCode = rejection
          res.end()
          return
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405
          res.setHeader('allow', 'GET, HEAD')
          res.end()
          return
        }
        const payload = await projectLinkPayload()
        const body = JSON.stringify(payload)
        res.statusCode = 200
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.setHeader('content-length', Buffer.byteLength(body))
        res.end(req.method === 'HEAD' ? undefined : body)
      },
    })
    // `ctx.effect` ties the route to the plugin's lifetime, so disabling the
    // plugin removes it. A context without it still gets the route — a route
    // left behind is a smaller fault than a button that silently never works —
    // and the disposer the server hands back is then simply dropped.
    if (typeof ctx?.effect === 'function') {
      ctx.effect(() => register(), 'dsh-model-flatmap: project-link route')
    } else {
      register()
    }
  } catch (error) {
    warnOnce(ctx, `dsh-model-flatmap: the project-link route was not registered (plugin unaffected): ${String(error?.message ?? error)}`)
  }
}

/**
 * Read one telemetry-settings request body.
 *
 * Only `{ enabled: boolean }` is accepted. Anything else is a 400 rather than a
 * guess: the file gates a real network send, so a malformed write must not be
 * silently coerced into "on" or "off".
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {Promise<{enabled: boolean}|null>} the parsed body, or `null` if invalid.
 */
async function readTelemetryBody(req) {
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '')
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (typeof parsed.enabled !== 'boolean') return null
    return { enabled: parsed.enabled }
  } catch {
    return null
  }
}

/**
 * Register the telemetry-settings route (DEC-035).
 *
 * `GET` answers the choice the Host will honour on its next send; `POST`
 * persists a new one. Both are behind the trust fence, and both degrade to
 * "route absent" rather than throwing: a composition without a web server has
 * no toggle channel, so the browser keeps its `localStorage` choice and the
 * Host keeps reporting — the pre-toggle behaviour.
 *
 * @param {object} ctx - the Host plugin context.
 * @returns {void}
 */
function registerTelemetrySettings(ctx) {
  let webServer
  try {
    webServer = typeof ctx?.get === 'function' ? ctx.get('webServer') : undefined
  } catch {
    webServer = undefined
  }
  if (webServer === undefined || typeof webServer.register !== 'function') return

  try {
    const register = () => webServer.register({
      kind: 'exact',
      path: TELEMETRY_SETTINGS_PATH,
      handler: async (req, res) => {
        const rejection = trustRejection(ctx, req)
        if (rejection !== undefined) {
          res.statusCode = rejection
          res.end()
          return
        }
        const method = req.method
        if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
          res.statusCode = 405
          res.setHeader('allow', 'GET, HEAD, POST')
          res.end()
          return
        }
        // A read answers the file as it stands. A write is applied first so the
        // next heartbeat — including a re-check already in flight — sees it.
        if (method === 'POST') {
          const body = await readTelemetryBody(req)
          if (body === null) {
            res.statusCode = 400
            res.setHeader('content-type', 'application/json; charset=utf-8')
            const problem = JSON.stringify({ ok: false, error: 'expected { enabled: boolean }' })
            res.setHeader('content-length', Buffer.byteLength(problem))
            res.end(problem)
            return
          }
          try {
            await writeSettingsFile(resolveDataDir(), body)
          } catch (error) {
            // An unwritable home is not the toggle's fault; report it honestly
            // so the browser can say the choice did not stick.
            warnOnce(ctx, `dsh-model-flatmap: telemetry settings could not be written: ${String(error?.message ?? error)}`)
            res.statusCode = 500
            res.end()
            return
          }
        }
        const settings = await readSettingsFile(resolveDataDir())
        const payload = JSON.stringify({ ok: true, enabled: settings.enabled })
        res.statusCode = 200
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.setHeader('content-length', Buffer.byteLength(payload))
        res.end(method === 'HEAD' ? undefined : payload)
      },
    })
    if (typeof ctx?.effect === 'function') {
      ctx.effect(() => register(), 'dsh-model-flatmap: telemetry-settings route')
    } else {
      register()
    }
  } catch (error) {
    warnOnce(ctx, `dsh-model-flatmap: the telemetry-settings route was not registered (plugin unaffected): ${String(error?.message ?? error)}`)
  }
}

/**
 * Apply the Host/Origin fence and require an authenticated live Peer.
 *
 * `connection.requestRejection` is the public entry point for exactly this
 * check. When the Connection service is absent (a composition that serves no
 * browser), there is no fence to consult and the route stays reachable — which
 * is the same trust level as the surrounding server.
 *
 * @param {object} ctx - the Host plugin context.
 * @param {import('node:http').IncomingMessage} req - the request to check.
 * @returns {number|undefined} the rejection status, or `undefined` to proceed.
 */
function trustRejection(ctx, req) {
  let connection
  try {
    connection = typeof ctx?.get === 'function' ? ctx.get('connection') : undefined
  } catch {
    connection = undefined
  }
  if (connection === undefined || typeof connection.requestRejection !== 'function') return undefined
  try {
    const rejection = connection.requestRejection(req)
    return typeof rejection === 'number' ? rejection : undefined
  } catch {
    // A fence that cannot answer must not open the route: fail closed.
    return 403
  }
}

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
 * Send this machine's daily heartbeat, if it has not been sent today AND the
 * user has not switched the collection off (DEC-035).
 *
 * The toggle lives in the browser, so its choice is mirrored into
 * `telemetry-settings.json` through the telemetry-settings route. A missing or
 * unreadable file means **enabled** — the collection is opt-out, so a machine
 * whose browser never opened Settings keeps reporting exactly as before.
 *
 * @param {object} ctx - The Host plugin context, used only for its logger.
 * @returns {Promise<{sent: boolean, kind: string|null, reason: string}|null>}
 *   The reporter's result, or `null` when reporting could not even be set up.
 */
async function heartbeat(ctx) {
  const pkg = readOwnPackage()
  let enabled = true
  try {
    // Read fresh on EVERY send (start and each re-check), so flipping the
    // toggle takes effect on the next check without a restart.
    enabled = (await readSettingsFile(resolveDataDir())).enabled
  } catch {
    enabled = true
  }
  if (enabled !== true) return { sent: false, kind: null, reason: 'opted-out' }
  try {
    return await new TelemetryReporter({
      dir: resolveDataDir(),
      logger: ctx?.logger,
      // Both values come from the manifest rather than constants: a fork that
      // renames the package must land on its own statistics line, not merge
      // into this one.
      pluginId: typeof pkg.name === 'string' ? pkg.name : '',
      enabled,
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

  // The panel's project-link button reads the checkout through this route (see
  // `repo-url.js`). It is registered last and swallows its own failures: a
  // composition with no web server must still load the picker.
  registerProjectLink(ctx)

  // The Settings toggle mirrors its choice into the data directory through this
  // route (see DEC-035). Like the link route it swallows its own failures: with
  // no web server the browser keeps its localStorage choice and the Host keeps
  // reporting, which is the pre-toggle behaviour.
  registerTelemetrySettings(ctx)
}
