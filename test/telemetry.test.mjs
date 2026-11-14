/**
 * Tests for the Host half's anonymous heartbeat (`telemetry.js`, `index.js`).
 *
 * This layer has failure modes that all fail **silently**, which is exactly why
 * it needs assertions rather than a manual check:
 *
 *   - "sent twice in one day" quietly inflates DAU, and every number built on it
 *     becomes untrustworthy;
 *   - a field added to the payload is invisible until it is an incident;
 *   - a heartbeat that throws, or that the Host awaits, turns a statistics
 *     problem into a plugin fault.
 *
 * No test touches the network: `fetchImpl` and `clock` are injected and every
 * state directory is a temp dir removed afterwards.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  DATA_DIR_NAME,
  DEFAULT_ENDPOINT,
  STATE_FILE,
  TelemetryReporter,
  buildPayload,
  decideKind,
  expandHomePath,
  isValidInstallId,
  newInstallId,
  normalizePluginId,
  normalizeVersion,
  parseState,
  resolveDataDir,
  resolveDshHome,
  resolveEndpoint,
  serializeState,
  shanghaiDay,
} from '../telemetry.js'

const here = dirname(fileURLToPath(import.meta.url))
const PLUGIN = 'dsh-model-flatmap'

/** Run `fn` against a fresh temp directory, then remove it. */
async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-flatmap-telemetry-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** A fetch stub that must never be called: calling it proves a promised silence broke. */
function forbiddenFetch() {
  let calls = 0
  const impl = async () => {
    calls += 1
    throw new Error('fetch must not be called')
  }
  return { impl, calls: () => calls }
}

/** A fetch stub recording every call and answering a fixed status. */
function stubFetch(status = 202) {
  const calls = []
  const impl = async (url, options) => {
    calls.push({ url, options })
    return { ok: status >= 200 && status < 300, status }
  }
  return { impl, calls: () => calls }
}

const DAY_ONE = Date.parse('2026-11-14T02:00:00Z') // 10:00 Asia/Shanghai
const DAY_TWO = Date.parse('2026-11-15T02:00:00Z')

test('shanghaiDay counts UTC+8 calendar days, so a UTC-zero crossing is the same local day', () => {
  // 2026-11-02T16:30:00Z = 2026-11-03 00:30 in Shanghai → local day 11-03.
  assert.equal(shanghaiDay(Date.parse('2026-11-02T16:30:00Z')), '2026-11-03')
  // 2026-11-02T15:59:00Z = 2026-11-02 23:59 in Shanghai → still 11-02.
  assert.equal(shanghaiDay(Date.parse('2026-11-02T15:59:00Z')), '2026-11-02')
  assert.equal(shanghaiDay(NaN), '')
  assert.equal(shanghaiDay(undefined), '')
})

test('installation ids are UUIDv4 only', () => {
  assert.equal(isValidInstallId(newInstallId()), true)
  assert.equal(isValidInstallId('not-a-uuid'), false)
  assert.equal(isValidInstallId(''), false)
  assert.equal(isValidInstallId(null), false)
  assert.equal(isValidInstallId(undefined), false)
  // A v1 UUID must be rejected: this module never produces one.
  assert.equal(isValidInstallId('f79dcf33-abcd-1803-98bd-38f0800b8ced'), false)
  // And two generated ids differ (a constant would collapse every install into one).
  assert.notEqual(newInstallId(), newInstallId())
})

test('state round-trips with a stable field order', () => {
  const state = parseState(serializeState({
    installId: newInstallId(),
    firstRunAt: 1730505600000,
    firstVersion: '1.2.3',
    lastSentDay: '2026-11-02',
    lastAttemptDay: '2026-11-02',
    lastOkDay: '2026-11-02',
    failures: 0,
    degraded: false,
  }))
  assert.equal(state.firstRunAt, 1730505600000)
  assert.equal(state.firstVersion, '1.2.3')
  assert.equal(state.lastSentDay, '2026-11-02')
  assert.equal(state.lastOkDay, '2026-11-02')
  assert.equal(state.failures, 0)
  assert.equal(state.degraded, false)
  // Fixed order keeps the file readable by hand.
  assert.match(serializeState(state), /"installId"[\s\S]*"degraded"/)
})

test('a damaged state file degrades to a new install instead of never reporting again', () => {
  for (const bad of ['', '{', '[]', 'null', '{"installId":"nope"}', '{"failures":"x"}']) {
    const state = parseState(bad)
    assert.equal(state.installId, null, `input ${bad}`)
    assert.equal(state.firstRunAt, null, `input ${bad}`)
    assert.equal(state.failures, 0, `input ${bad}`)
    assert.equal(state.degraded, false, `input ${bad}`)
  }
})

test('decideKind truth table', () => {
  const fresh = parseState('')
  const installed = parseState(serializeState({
    installId: newInstallId(),
    firstRunAt: 1730505600000,
    firstVersion: '1.0.0',
  }))

  // A brand-new install reports as `install`, whatever it was installed on.
  assert.equal(decideKind(fresh, { today: '2026-11-02' }), 'install')
  // An installed machine reports a heartbeat.
  assert.equal(decideKind(installed, { today: '2026-11-02' }), 'heartbeat')
  // Already attempted today: nothing. This is the "at most one per day" gate.
  const attempted = { ...installed, lastAttemptDay: '2026-11-02' }
  assert.equal(decideKind(attempted, { today: '2026-11-02' }), null)
  // The next day it reports again — the precondition for DAU existing at all.
  assert.equal(decideKind(attempted, { today: '2026-11-03' }), 'heartbeat')
  // A degraded reporter stays silent.
  assert.equal(decideKind({ ...installed, degraded: true }, { today: '2026-11-02' }), null)
  // Without a day there is no dedupe, so there is no send.
  assert.equal(decideKind(installed, { today: '' }), null)
  assert.equal(decideKind(installed, {}), null)
})

test('buildPayload carries only the allowed fields and has no free-text slot', () => {
  const payload = buildPayload({
    pluginId: PLUGIN,
    installId: '8dec1da9-8712-4b12-8323-2957c13bf391',
    kind: 'heartbeat',
    version: '1.2.3',
    platform: 'darwin',
    arch: 'arm64',
    hostVersion: '',
  })
  assert.deepEqual(Object.keys(payload).sort(), ['arch', 'id', 'k', 'os', 'p', 'v', 'ver'])
  assert.equal(payload.p, PLUGIN)
  assert.equal(payload.v, 1)
  assert.equal(payload.k, 'heartbeat')
  // An unknown host version is omitted, never guessed or faked.
  assert.equal(payload.host, undefined)

  // Forbidden fields: any one of these appearing would be a privacy incident.
  for (const name of ['prompt', 'key', 'token', 'path', 'cwd', 'url', 'user', 'ip', 'session', 'email', 'model']) {
    assert.equal(payload[name], undefined, `payload must not contain ${name}`)
  }

  // There is nowhere to put free text: every field is whitelisted.
  const dirty = buildPayload({
    pluginId: 'Dsh-Model-Flatmap ',
    installId: newInstallId(),
    kind: 'install',
    version: '1.0.0; rm -rf / # 中文',
    platform: 'dar win',
    arch: 'arm 64',
  })
  assert.equal(dirty.p, PLUGIN)
  assert.equal(dirty.ver, '1.0.0rm-rf')
  assert.equal(dirty.os, 'darwin')
  assert.equal(dirty.arch, 'arm64')
})

test('normalizePluginId / normalizeVersion / resolveEndpoint fall back sanely', () => {
  assert.equal(normalizePluginId(PLUGIN), PLUGIN)
  assert.equal(normalizePluginId('  DSH-Model-Flatmap  '), PLUGIN)
  assert.equal(normalizePluginId(''), '')
  assert.equal(normalizePluginId('-leading-dash'), '')
  assert.equal(normalizePluginId('has space'), '')
  assert.equal(normalizePluginId('x'.repeat(48)).length, 48)
  assert.equal(normalizePluginId('x'.repeat(49)), '')

  assert.equal(normalizeVersion('  1.2.3-rc.1  '), '1.2.3-rc.1')
  assert.equal(normalizeVersion('1.0 <script>'), '1.0script')
  assert.equal(normalizeVersion(''), '')

  // Blank, malformed or non-http endpoints fall back — never send them anywhere odd.
  assert.equal(resolveEndpoint(''), DEFAULT_ENDPOINT)
  assert.equal(resolveEndpoint('   '), DEFAULT_ENDPOINT)
  assert.equal(resolveEndpoint('ftp://example.com/x'), DEFAULT_ENDPOINT)
  assert.equal(resolveEndpoint('not a url'), DEFAULT_ENDPOINT)
  assert.equal(resolveEndpoint('https://example.com/api'), 'https://example.com/api')
})

test('a new installation reports once, and the next day reports a heartbeat', async () => {
  await withTempDir(async (dir) => {
    const { impl, calls } = stubFetch()
    const first = new TelemetryReporter({
      dir,
      pluginId: PLUGIN,
      fetchImpl: impl,
      clock: () => DAY_ONE,
    })
    const result = await first.start({ version: '1.2.3', platform: 'darwin', arch: 'arm64' })
    assert.equal(result.sent, true)
    assert.equal(result.kind, 'install')
    assert.equal(calls().length, 1)

    // The body is exactly the allowed shape, and it names its sender.
    const body = JSON.parse(calls()[0].options.body)
    assert.equal(body.p, PLUGIN)
    assert.equal(body.k, 'install')
    assert.equal(body.ver, '1.2.3')
    assert.equal(isValidInstallId(body.id), true)

    // The next day is a heartbeat — the premise of DAU.
    const second = new TelemetryReporter({
      dir,
      pluginId: PLUGIN,
      fetchImpl: impl,
      clock: () => DAY_TWO,
    })
    const next = await second.start({ version: '1.2.3' })
    assert.equal(next.sent, true)
    assert.equal(next.kind, 'heartbeat')
    assert.equal(calls().length, 2)
    // The installation id is stable across days: one machine is one install.
    assert.equal(JSON.parse(calls()[1].options.body).id, body.id)

    // The state file records what happened, and stays private.
    const state = JSON.parse(await readFile(join(dir, STATE_FILE), 'utf8'))
    assert.equal(state.lastSentDay, '2026-11-15')
    assert.equal(state.lastOkDay, '2026-11-15')
    assert.equal(state.firstVersion, '1.2.3')
    assert.equal(state.failures, 0)
    // 0600: the file is not secret, but nothing about it should be world-readable.
    const fileStat = await stat(join(dir, STATE_FILE))
    assert.equal(fileStat.mode & 0o777, 0o600)
  })
})

test('a second start on the same local day sends nothing', async () => {
  await withTempDir(async (dir) => {
    const { impl, calls } = stubFetch()
    const options = { dir, pluginId: PLUGIN, fetchImpl: impl, clock: () => DAY_ONE }
    await new TelemetryReporter(options).start({ version: '1.2.3' })
    await new TelemetryReporter(options).start({ version: '1.2.3' })
    await new TelemetryReporter(options).start({ version: '1.2.3' })
    assert.equal(calls().length, 1, 'one machine must report at most once per day')
  })
})

test('without a valid plugin id nothing is sent', async () => {
  await withTempDir(async (dir) => {
    const { impl, calls } = forbiddenFetch()
    const reporter = new TelemetryReporter({ dir, pluginId: 'not a plugin id', fetchImpl: impl })
    const result = await reporter.start({ version: '1.2.3' })
    assert.equal(result.sent, false)
    assert.equal(result.reason, 'not-due')
    assert.equal(calls(), 0)
    // And no state file is created for a reporter that cannot report.
    await assert.rejects(stat(join(dir, STATE_FILE)))
  })
})

test('a failing endpoint never throws and is not retried the same day', async () => {
  await withTempDir(async (dir) => {
    const failing = async () => {
      throw new Error('offline')
    }
    const reporter = new TelemetryReporter({ dir, pluginId: PLUGIN, fetchImpl: failing, clock: () => DAY_ONE })
    const result = await reporter.start({ version: '1.2.3' })
    assert.equal(result.sent, false)
    assert.equal(result.reason, 'http-failed')

    const state = JSON.parse(await readFile(join(dir, STATE_FILE), 'utf8'))
    assert.equal(state.failures, 1)
    assert.equal(state.lastSentDay, '', 'a failed report must not look like a delivered one')

    // Same day: the attempt was recorded, so no second request.
    let attempts = 0
    const counting = async () => {
      attempts += 1
      return { ok: true, status: 202 }
    }
    const retry = new TelemetryReporter({ dir, pluginId: PLUGIN, fetchImpl: counting, clock: () => DAY_ONE })
    assert.equal((await retry.start({ version: '1.2.3' })).sent, false)
    assert.equal(attempts, 0)
  })
})

test('the reporter gives up after 30 consecutive failures', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, STATE_FILE), serializeState({
      installId: newInstallId(),
      firstRunAt: 1730505600000,
      lastAttemptDay: '2026-11-01',
      failures: 29,
    }))
    const failing = async () => ({ ok: false, status: 500 })
    const result = await new TelemetryReporter({
      dir,
      pluginId: PLUGIN,
      fetchImpl: failing,
      clock: () => DAY_ONE,
    }).start({ version: '1.2.3' })
    assert.equal(result.sent, false)

    const state = JSON.parse(await readFile(join(dir, STATE_FILE), 'utf8'))
    assert.equal(state.failures, 30)
    assert.equal(state.degraded, true)

    // Degraded means silent from now on: not "silent for a while".
    const { impl, calls } = forbiddenFetch()
    const after = await new TelemetryReporter({
      dir,
      pluginId: PLUGIN,
      fetchImpl: impl,
      clock: () => DAY_TWO,
    }).start({ version: '1.2.3' })
    assert.equal(after.sent, false)
    assert.equal(calls(), 0)
  })
})

test('an unwritable data directory costs a heartbeat, not an exception', async () => {
  await withTempDir(async (dir) => {
    // A file where the data directory should be: mkdir fails with ENOTDIR.
    const blocked = join(dir, 'blocked')
    await writeFile(blocked, 'not a directory')
    const { impl, calls } = stubFetch()
    const result = await new TelemetryReporter({
      dir: blocked,
      pluginId: PLUGIN,
      fetchImpl: impl,
      clock: () => DAY_ONE,
    }).start({ version: '1.2.3' })
    // The state could not be written, so nothing is sent: without a record of
    // the attempt, sending would risk a second report on the next start.
    assert.equal(result.sent, false)
    assert.equal(calls().length, 0)
  })
})

test('a runtime without fetch is simply a missed heartbeat, not a crash', async () => {
  await withTempDir(async (dir) => {
    // Deliberately a non-function: the guard must not fall through to a real
    // network call, and no test may ever reach the endpoint.
    const result = await new TelemetryReporter({
      dir,
      pluginId: PLUGIN,
      fetchImpl: 'not a function',
      clock: () => DAY_ONE,
    }).start({ version: '1.2.3' })
    assert.equal(result.sent, false)
    assert.equal(result.reason, 'http-failed')
  })
})

test('the request is a bounded POST to the documented endpoint', async () => {
  await withTempDir(async (dir) => {
    const { impl, calls } = stubFetch(202)
    await new TelemetryReporter({ dir, pluginId: PLUGIN, fetchImpl: impl, clock: () => DAY_ONE })
      .start({ version: '1.2.3', platform: 'linux', arch: 'x64' })
    const call = calls()[0]
    assert.equal(call.url, DEFAULT_ENDPOINT)
    assert.equal(call.options.method, 'POST')
    assert.equal(call.options.headers['content-type'], 'application/json')
    // A signal is always attached: the heartbeat has a timeout.
    assert.ok(call.options.signal, 'the request must carry an abort signal')
  })
})

test('the data directory follows the hosts own home rules', () => {
  // $DSH_HOME wins over ~/.dsh; a blank value counts as unset.
  assert.equal(resolveDshHome({ env: { DSH_HOME: '/tmp/dsh-home' } }), '/tmp/dsh-home')
  assert.equal(resolveDshHome({ env: { DSH_HOME: '   ' } }).endsWith(DATA_DIR_NAME), false)
  assert.equal(resolveDshHome({ env: { DSH_HOME: '   ' } }).endsWith('.dsh'), true)
  assert.equal(resolveDshHome({ env: {} }).endsWith('.dsh'), true)
  // Relative values are made absolute, so the file cannot drift with the cwd.
  const relative = resolveDshHome({ env: { DSH_HOME: 'rel/home' } })
  assert.equal(relative.startsWith('/'), true)
  assert.equal(relative, resolveDshHome({ env: { DSH_HOME: './rel/home' } }))
  // The plugin keeps its own directory under the home.
  assert.equal(
    resolveDataDir({ env: { DSH_HOME: '/tmp/dsh-home' } }),
    join('/tmp/dsh-home', DATA_DIR_NAME),
  )
  // Tilde expansion handles both separators; ~user is left alone.
  assert.equal(expandHomePath('~alice/x'), '~alice/x')
  assert.equal(expandHomePath('~').includes('/') || expandHomePath('~').includes('\\'), true)
})

/** Captured before any test replaces it, so the harness can still sleep. */
const realSetTimeout = globalThis.setTimeout

/**
 * Run `fn` with the DSH home redirected into a temp dir, `fetch` stubbed and
 * `setInterval` / `clearInterval` captured. Nothing here may reach the network
 * or the real home directory.
 */
async function withHostStubs(fn) {
  await withTempDir(async (dir) => {
    const { impl, calls } = stubFetch()
    const originalFetch = globalThis.fetch
    const originalInterval = globalThis.setInterval
    const originalClear = globalThis.clearInterval
    const originalHome = process.env.DSH_HOME
    const timers = []
    const effects = []
    const warnings = []
    globalThis.fetch = impl
    globalThis.setInterval = (callback, ms) => {
      const timer = { callback, ms, unref() { this.unrefd = true }, cleared: false }
      timers.push(timer)
      return timer
    }
    globalThis.clearInterval = (timer) => {
      if (timer) timer.cleared = true
    }
    process.env.DSH_HOME = dir
    try {
      return await fn({
        dir,
        calls,
        timers,
        effects,
        ctx: {
          logger: { warn: (message) => warnings.push(message) },
          effect: (factory) => { effects.push(factory()) },
        },
        warnings,
      })
    } finally {
      globalThis.fetch = originalFetch
      globalThis.setInterval = originalInterval
      globalThis.clearInterval = originalClear
      if (originalHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = originalHome
      // Let any in-flight heartbeat settle before the temp dir disappears.
      await new Promise((resolve) => realSetTimeout(resolve, 200))
    }
  })
}

test('the Host entry reports on start, without awaiting or throwing', async () => {
  const entry = await import('../index.js')
  assert.equal(entry.name, PLUGIN)
  assert.deepEqual(entry.inject, [])
  assert.equal(typeof entry.apply, 'function')
  assert.equal(entry.apply.length, 1)
  // The re-check interval must be short enough to matter and long enough to
  // cost nothing: several checks a day, never a hot loop.
  assert.ok(entry.RECHECK_MS > 0 && entry.RECHECK_MS <= 12 * 60 * 60 * 1000)

  await withHostStubs(async ({ dir, calls, timers, effects, ctx }) => {
    // `apply` must return synchronously: the heartbeat is a bypass, not a step.
    const returned = entry.apply(ctx)
    assert.equal(returned, undefined, 'apply must not await the heartbeat')

    // The launch heartbeat really was sent, from the redirected home.
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(calls().length, 1)
    const state = JSON.parse(await readFile(join(dir, DATA_DIR_NAME, STATE_FILE), 'utf8'))
    assert.equal(state.installId, JSON.parse(calls()[0].options.body).id)

    // A re-check timer exists, owns its disposer, and never holds the loop open.
    assert.equal(timers.length, 1)
    assert.equal(timers[0].ms, entry.RECHECK_MS)
    assert.equal(timers[0].unrefd, true, 'the re-check timer must be unref-ed')
    assert.equal(effects.length, 1)
    assert.equal(typeof effects[0], 'function')

    // Firing a re-check on the same day must stay silent: the state file, not a
    // network round trip, answers "already done today".
    timers[0].callback()
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(calls().length, 1, 'a same-day re-check must not send')

    // The disposer clears the timer, so disabling the plugin stops the checks.
    effects[0]()
    assert.equal(timers[0].cleared, true, 'the lifecycle disposer must clear the timer')
  })
})

test('the Host entry reads the plugin id from its own manifest', async () => {
  const manifest = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8'))
  // The payload self-identifies, so the id has to be the shipped package name —
  // a hardcoded copy would silently merge a fork into this statistics line.
  assert.equal(manifest.name, PLUGIN)
  assert.equal(normalizePluginId(manifest.name), PLUGIN)
  assert.match(manifest.version, /^\d+\.\d+\.\d+/)
})
