/**
 * Host half of the flat model picker bundle.
 *
 * The plugin is client-side and runs in both the Web GUI and the Desktop app: it
 * replaces the composer's `conversation.input.model` seat with a flat panel rendered
 * in the client UI, and reads the Session's model directory, projections and
 * `session.selectModel` through public Client APIs.
 *
 * The Host contributes no service, tool or event. It has two jobs of its own:
 *
 * 1. The anonymous daily heartbeat in `telemetry.js` (see DEC-031), which is
 *    how the project can tell how many machines actually run the picker and how
 *    many of them ran it today. npm downloads cannot answer that (CI, mirrors
 *    and reinstalls all count) and a Client-side counter cannot either (a tab
 *    that is never reloaded reports nothing). The user can switch it off in
 *    Settings (see DEC-035); the Host honours that choice on every send.
 * 2. One telemetry-settings route the Settings toggle mirrors its choice
 *    through (see DEC-035). The toggle lives in the browser, the send happens
 *    here, so the browser writes its choice to a file this half reads before
 *    every send.
 * 3. One config route (see DEC-060). The model-visibility switches and provider
 *    renames live in the browser, but their source of truth is
 *    `$DSH_HOME/dsh-model-flatmap/config.yaml` — a file the user can read, diff,
 *    back up and hand-edit. This half owns that file; the route is the only way
 *    the browser reaches it.
 *
 * Both jobs read the plugin's data directory at `$DSH_HOME/plugins/dsh-model-flatmap/`
 * and both run `migrateLegacyDataDir()` first (DEC-059): a data directory left
 * over from before the `plugins/` move is relocated exactly once, before
 * anything is read. A failed migration is swallowed there and the legacy
 * directory stays in use, so this half never has to know it happened.
 *
 * Two rules keep those jobs from ever becoming the Host's problem:
 *
 * 1. Both run off any startup path — the heartbeat inside `void`, the settings
 *    route only when the toggle is written — so the picker's UI is live before
 *    either does anything.
 * 2. Every failure is swallowed into at most one log line, or into the
 *    documented fallback. A dead endpoint, a read-only home directory, a
 *    missing `crypto` or an unwritable settings file must cost the plugin
 *    nothing; statistics can never be a plugin fault.
 */
import { readFileSync } from 'node:fs'

import {
  readConfigFile,
  resolveConfigFile,
  writeConfigFile,
} from './config.js'
import {
  TelemetryReporter,
  migrateLegacyDataDir,
  readSettingsFile,
  resolvePluginDataDir,
  writeSettingsFile,
} from './telemetry.js'

export const name = 'dsh-model-flatmap'

/**
 * Services the Host half reads, all optional at call time.
 *
 * `webServer` carries the telemetry-settings route; `connection` supplies the
 * trust fence that route is checked against. Neither is required for the picker
 * itself, so a composition without them still loads: that route is then simply
 * not registered.
 */
export const inject = []

/**
 * Path of the telemetry-settings route the Settings toggle talks to (DEC-035).
 *
 * The toggle lives in the browser, but the heartbeat sends from here, so the
 * browser mirrors its choice into a file this half reads before every send.
 * `GET` answers the current choice; `POST` writes a new one. Namespaced under
 * the package name, and behind the same trust
 * fence — without it any web page could flip this machine's reporting.
 */
export const TELEMETRY_SETTINGS_PATH = '/dsh-model-flatmap/telemetry-settings'

/**
 * Path of the config route (DEC-060).
 *
 * `GET` answers the config file as it stands on disk — including a hand-edit the
 * browser has never seen, which is the point of moving this out of
 * `localStorage`. `POST` replaces it with the record the browser sends.
 *
 * Behind the same trust fence as the telemetry route: this file decides which
 * models the machine shows, so an arbitrary web page must not be able to flip it.
 */
export const CONFIG_ROUTE_PATH = '/dsh-model-flatmap/config'

/**
 * Read one config request body.
 *
 * Only `{hidden?: string[], aliases?: Record<string, string>}` is accepted, and
 * every field is validated rather than coerced: this body becomes the file that
 * decides which models a user sees, so a malformed write must be a 400, never a
 * guess. An absent field means "empty", because the browser always posts the
 * full record — a POST is a replace, not a patch.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {Promise<{hidden: Set<string>, aliases: Map<string,string>}|null>}
 *   the parsed config, or `null` if invalid.
 */
async function readConfigBody(req) {
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '')
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    for (const key of Object.keys(parsed)) {
      if (key !== 'hidden' && key !== 'aliases' && key !== 'teamDefault') return null
    }
    const hidden = new Set()
    if (parsed.hidden !== undefined) {
      if (!Array.isArray(parsed.hidden)) return null
      for (const item of parsed.hidden) {
        if (typeof item !== 'string' || item === '') return null
        hidden.add(item)
      }
    }
    const aliases = new Map()
    if (parsed.aliases !== undefined) {
      if (parsed.aliases === null || typeof parsed.aliases !== 'object' || Array.isArray(parsed.aliases)) return null
      for (const [id, name] of Object.entries(parsed.aliases)) {
        if (id === '' || typeof name !== 'string' || name === '') return null
        aliases.set(id, name)
      }
    }
    // `teamDefault` is optional so an older browser build — one that predates
    // the section — keeps writing the two record sections it knows about
    // instead of having every save rejected. An absent field therefore stays
    // `undefined` here: it means "this build says nothing", and the handler
    // keeps whatever the file already holds. Defaulting it to `false` would
    // silently switch the user's preference off on every visibility change.
    let teamDefault
    if (parsed.teamDefault !== undefined) {
      if (typeof parsed.teamDefault !== 'boolean') return null
      teamDefault = parsed.teamDefault
    }
    return { hidden, aliases, teamDefault }
  } catch {
    return null
  }
}

/**
 * Turn a config into the JSON body both halves exchange.
 *
 * Sorted, so two responses that differ in one switch differ in one line.
 *
 * @param {{hidden: Set<string>, aliases: Map<string,string>}} config - the config.
 * @returns {string} JSON text.
 */
function configPayload(config) {
  return JSON.stringify({
    ok: true,
    hidden: [...config.hidden].sort(),
    aliases: Object.fromEntries([...config.aliases.entries()].sort(([left], [right]) => (
      left < right ? -1 : left > right ? 1 : 0
    ))),
    teamDefault: config.teamDefault === true,
  })
}

/**
 * Run one route installer where the web server actually is.
 *
 * The one-shot `ctx.get('webServer')` this used to do at activation is what made
 * the whole settings bridge unreliable: routes mount in composition order, so
 * whenever the server arrived after this plugin the lookup returned `undefined`,
 * both installers returned silently, and every browser GET/POST answered 404 for
 * the life of the process. The file switched things on, the route could not write
 * them back, and the preference reset on the next launch — a symptom that looks
 * like a lost setting rather than a missing route.
 *
 * `ctx.inject` is the documented optional-service channel: the callback runs when
 * the service mounts (and again if it remounts), and its registrations belong to
 * that service's lifetime. Exact identity matters — the callback receives a
 * context scoped to the injected service, so `ctx.get('webServer')` inside it
 * resolves to that server and not to whatever is globally present.
 *
 * The direct call is the fallback for a context that has no `inject` verb: it is
 * the pre-existing behaviour, and it still works whenever the server is already up.
 *
 * @param {object} ctx - the Host plugin context.
 * @param {(scope: object) => void} install - the installer, run with a scope that can see the server.
 * @returns {void}
 */
function withWebServer(ctx, install) {
  if (typeof ctx?.inject === 'function') {
    try {
      ctx.inject(['webServer'], scope => install(scope))
      return
    } catch (error) {
      warnOnce(ctx, `dsh-model-flatmap: a route could not wait for the web server (plugin unaffected): ${String(error?.message ?? error)}`)
    }
  }
  install(ctx)
}

/**
 * Register the config route (DEC-060).
 *
 * `GET` reads the file fresh on every request: a hand-edit must take effect
 * without a restart, and a cached answer would defeat the whole reason this file
 * exists. `POST` writes it atomically.
 *
 * A corrupt file is a 500 with the reason, never an empty config: reporting
 * "nothing is hidden" would silently un-hide every model the user switched off,
 * and they would have no way to tell why.
 *
 * @param {object} ctx - the Host plugin context.
 * @returns {void}
 */
function registerConfigRoute(ctx) {
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
      path: CONFIG_ROUTE_PATH,
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
        const path = resolveConfigFile()
        if (method === 'POST') {
          const body = await readConfigBody(req)
          // A body without `teamDefault` comes from a browser build that does
          // not know the section. Carry the file's value through so that build's
          // save cannot turn the user's default off behind their back.
          if (body !== null && body.teamDefault === undefined) {
            try {
              body.teamDefault = readConfigFile(path).teamDefault === true
            } catch {
              // A file that does not parse is about to be replaced anyway; the
              // built-in default is the only value left to write.
              body.teamDefault = false
            }
          }
          if (body === null) {
            res.statusCode = 400
            res.setHeader('content-type', 'application/json; charset=utf-8')
            const problem = JSON.stringify({ ok: false, error: 'expected { hidden?: string[], aliases?: Record<string, string> }' })
            res.setHeader('content-length', Buffer.byteLength(problem))
            res.end(problem)
            return
          }
          try {
            writeConfigFile(path, body)
          } catch (error) {
            // An unwritable home is not the toggle's fault; say so honestly so
            // the browser can tell the user the change did not stick.
            warnOnce(ctx, `dsh-model-flatmap: config could not be written: ${String(error?.message ?? error)}`)
            res.statusCode = 500
            res.end()
            return
          }
        }
        let config
        try {
          config = readConfigFile(path)
        } catch (error) {
          // The file exists but does not parse. Report it; do not pretend it
          // said "nothing is hidden".
          res.statusCode = 500
          res.setHeader('content-type', 'application/json; charset=utf-8')
          const problem = JSON.stringify({ ok: false, error: String(error?.message ?? error) })
          res.setHeader('content-length', Buffer.byteLength(problem))
          res.end(problem)
          return
        }
        const payload = configPayload(config)
        res.statusCode = 200
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.setHeader('content-length', Buffer.byteLength(payload))
        res.end(method === 'HEAD' ? undefined : payload)
      },
    })
    if (typeof ctx?.effect === 'function') {
      ctx.effect(() => register(), 'dsh-model-flatmap: config route')
    } else {
      register()
    }
  } catch (error) {
    warnOnce(ctx, `dsh-model-flatmap: the config route was not registered (plugin unaffected): ${String(error?.message ?? error)}`)
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
            await migrateLegacyDataDir()
            await writeSettingsFile(resolvePluginDataDir(), body)
          } catch (error) {
            // An unwritable home is not the toggle's fault; report it honestly
            // so the browser can say the choice did not stick.
            warnOnce(ctx, `dsh-model-flatmap: telemetry settings could not be written: ${String(error?.message ?? error)}`)
            res.statusCode = 500
            res.end()
            return
          }
        }
        await migrateLegacyDataDir()
        const settings = await readSettingsFile(resolvePluginDataDir())
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
/**
 * Whether the user asked new Sessions to start with teamwork on (DEC-063).
 *
 * Read from `config.yaml` on EVERY use rather than cached: the file is the one
 * source of truth, the user can edit it by hand, and a Session is created rarely
 * enough that one small file read costs nothing. A missing or damaged file means
 * "off", which is the built-in default and the same default the Host's own
 * `agent-team.defaultEnabled` carries.
 *
 * @returns {Promise<boolean>} whether new roots should start enabled.
 */
async function readTeamDefaultPreference() {
  try {
    return readConfigFile(resolveConfigFile()).teamDefault === true
  } catch {
    return false
  }
}

/**
 * Whether this Session has ever saved a `team/mode` selection.
 *
 * The Team projection's client view always reports `enabled` as a BOOLEAN
 * (`state.enabled === true`), so "nobody has chosen yet" is invisible from the
 * browser: it looks exactly like an explicit "off". The durable event log is the
 * only place that distinction still exists, so the check runs here, where the
 * raw events are at hand.
 *
 * Events inherited from a fork are excluded, mirroring the projection's own rule
 * (`event.seq < inheritedEventCount` means "not this Session's choice").
 *
 * @param {object} session - the live Session.
 * @returns {boolean} whether a selection is already saved.
 */
function hasSavedTeamMode(session) {
  const inherited = Number(session?.inheritedEventCount ?? 0)
  let events = []
  try {
    events = typeof session?.ownEvents === 'function'
      ? session.ownEvents()
      : (typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : [])
  } catch {
    // An unreadable log must not be read as "no choice": that would override an
    // explicit opt-out, which is worse than leaving the default unapplied.
    return true
  }
  if (!Array.isArray(events)) return true
  return events.some(event => event?.type === 'team/mode' && Number(event.seq ?? 0) >= inherited)
}

/** Read one Host service without letting a guarded context throw. */
function optionalService(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

/**
 * Apply the stored teamwork default to newly activated root Sessions (DEC-063).
 *
 * This is the same hook, with the same conditions, that the Host's own
 * `agent-team.defaultEnabled` uses: `agent/created` with `source === 'startup'`,
 * roots only, and only when no selection is saved yet. Doing it HERE rather than
 * in the panel matters for two reasons:
 *
 * 1. It runs before the Session's first model step, so the very first request
 *    already carries the Team tools and guidance — a panel-side write would only
 *    land once the user happened to open the picker.
 * 2. The browser cannot tell "no selection" from "explicitly off" (see
 *    `hasSavedTeamMode`), so the decision has to be made where that information
 *    exists.
 *
 * Every failure is swallowed: a missing Team service, an unwritable read, or a
 * rejected save must cost the Session nothing. The switch still works.
 *
 * @param {object} ctx - the Host plugin context.
 * @returns {void}
 */
export function installTeamDefault(ctx) {
  if (typeof ctx?.on !== 'function') return
  try {
    ctx.on('agent/created', async ({ agent, source }) => {
      if (source !== 'startup') return
      if (agent?.session?.header?.origin === 'subagent') return
      const teams = optionalService(ctx, 'agentTeams')
      if (teams === undefined || typeof teams.setEnabled !== 'function') return
      if (hasSavedTeamMode(agent.session)) return
      if (!(await readTeamDefaultPreference())) return
      await teams.setEnabled(agent, true)
    })
  } catch (error) {
    warnOnce(ctx, `dsh-model-flatmap: the teamwork default was not installed (plugin unaffected): ${String(error?.message ?? error)}`)
  }
}

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
 * The one-shot data directory migration runs first, before any read: reading a
 * stale legacy file and then migrating would report a day twice.
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
    await migrateLegacyDataDir()
    enabled = (await readSettingsFile(resolvePluginDataDir())).enabled
  } catch {
    enabled = true
  }
  if (enabled !== true) return { sent: false, kind: null, reason: 'opted-out' }
  try {
    return await new TelemetryReporter({
      dir: resolvePluginDataDir(),
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

  // The Settings toggle mirrors its choice into the data directory through this
  // route (see DEC-035). Like the link route it swallows its own failures: with
  // no web server the browser keeps its localStorage choice and the Host keeps
  // reporting, which is the pre-toggle behaviour.
  withWebServer(ctx, registerTelemetrySettings)

  // The model-visibility switches and provider renames read and write their
  // source of truth through this route (DEC-060). Same degradation rule: with no
  // web server the browser keeps its localStorage cache and the file simply is
  // not reachable from the UI.
  withWebServer(ctx, registerConfigRoute)

  // The teamwork default is applied here, not in the picker: only the Host can
  // tell "no selection saved" from "saved off", and only the Host can write it
  // before the Session's first model step (DEC-063).
  installTeamDefault(ctx)
}
