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
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  DATA_DIR_NAME,
  DEFAULT_ENDPOINT,
  SETTINGS_FILE,
  STATE_FILE,
  TelemetryReporter,
  buildPayload,
  decideKind,
  expandHomePath,
  isValidInstallId,
  newInstallId,
  normalizePluginId,
  normalizeVersion,
  parseSettings,
  parseState,
  readSettingsFile,
  resolveDataDir,
  resolveDshHome,
  resolveEndpoint,
  resolveLegacyDataDir,
  resolvePluginDataDir,
  migrateLegacyDataDir,
  serializeSettings,
  serializeState,
  shanghaiDay,
  writeSettingsFile,
} from '../telemetry.js'
import { writeConfigFile } from '../config.js'

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
  // The plugin keeps its own directory under the home, inside the shared
  // `plugins/` root every plugin data directory now lives in.
  assert.equal(
    resolveDataDir({ env: { DSH_HOME: '/tmp/dsh-home' } }),
    join('/tmp/dsh-home', 'plugins', DATA_DIR_NAME),
  )
  // The pre-`plugins/` location is still nameable: the one-shot migration and
  // its fallback both need to point at it.
  assert.equal(
    resolveLegacyDataDir({ env: { DSH_HOME: '/tmp/dsh-home' } }),
    join('/tmp/dsh-home', DATA_DIR_NAME),
  )
  // Tilde expansion handles both separators; ~user is left alone.
  assert.equal(expandHomePath('~alice/x'), '~alice/x')
  assert.equal(expandHomePath('~').includes('/') || expandHomePath('~').includes('\\'), true)
})


// ---------------------------------------------------------------------------
// One-shot data directory migration: ~/.dsh/dsh-model-flatmap/ (legacy) ->
// ~/.dsh/plugins/dsh-model-flatmap/ (current). The legacy location was the
// plugin's own directory for every release before this one, so an upgrade must
// carry the state files over exactly once and must never lose them.
// ---------------------------------------------------------------------------

/** Seed a legacy data directory with the two files that actually matter. */
async function seedLegacy(home, contents = {}) {
  const legacy = join(home, DATA_DIR_NAME)
  await mkdir(legacy, { recursive: true })
  await writeFile(join(legacy, STATE_FILE), contents.state ?? serializeState({
    installId: newInstallId(),
    firstRunAt: 1730505600000,
    firstVersion: '1.4.0',
    lastAttemptDay: '2026-11-19',
    lastOkDay: '2026-11-19',
  }))
  await writeFile(join(legacy, SETTINGS_FILE), contents.settings ?? serializeSettings({ enabled: false }))
  return legacy
}

test('a legacy data directory is moved to plugins/ on first run, files intact', async () => {
  await withTempDir(async (home) => {
    const legacy = await seedLegacy(home)
    const before = await readFile(join(legacy, STATE_FILE), 'utf8')

    const migrated = await migrateLegacyDataDir({ env: { DSH_HOME: home } })
    assert.equal(migrated, true, 'a legacy directory must be reported as migrated')

    const current = resolveDataDir({ env: { DSH_HOME: home } })
    // Whole directory, not just the files we know about.
    assert.equal(await readFile(join(current, STATE_FILE), 'utf8'), before)
    assert.deepEqual(await readSettingsFile(current), { enabled: false })
    // The old location is gone: leaving it behind would make the next start
    // migrate a second time, and the two copies would drift apart.
    await assert.rejects(stat(legacy))
  })
})

test('migration is idempotent: nothing to move means nothing happens', async () => {
  await withTempDir(async (home) => {
    // No legacy directory at all — the fresh-install path.
    assert.equal(await migrateLegacyDataDir({ env: { DSH_HOME: home } }), false)
    await assert.rejects(stat(resolveDataDir({ env: { DSH_HOME: home } })))
    // Second run after a successful migration is a no-op too.
    await seedLegacy(home)
    assert.equal(await migrateLegacyDataDir({ env: { DSH_HOME: home } }), true)
    assert.equal(await migrateLegacyDataDir({ env: { DSH_HOME: home } }), false)
  })
})

test('an existing plugins/ directory is never overwritten or merged into', async () => {
  await withTempDir(async (home) => {
    // Both locations exist (an interrupted earlier attempt, or a machine that
    // already ran a newer release). The current directory wins outright.
    const current = resolveDataDir({ env: { DSH_HOME: home } })
    await mkdir(current, { recursive: true })
    const kept = serializeState({ installId: newInstallId(), firstRunAt: 1730592000000 })
    await writeFile(join(current, STATE_FILE), kept)
    const legacy = await seedLegacy(home)

    assert.equal(await migrateLegacyDataDir({ env: { DSH_HOME: home } }), false)

    // Current untouched — not merged, not replaced.
    assert.equal(await readFile(join(current, STATE_FILE), 'utf8'), kept)
    await assert.rejects(stat(join(current, SETTINGS_FILE)), 'legacy files must not be copied in')
    // Legacy left exactly where it was: deleting data the user can still see is
    // worse than a stale directory nobody reads any more.
    assert.equal(typeof (await stat(join(legacy, STATE_FILE))).size, 'number')
  })
})

test('a failed migration is swallowed and the plugin keeps working', async () => {
  await withTempDir(async (home) => {
    await seedLegacy(home)
    const legacy = resolveLegacyDataDir({ env: { DSH_HOME: home } })

    // Fail both halves of the move: rename throws a non-EXDEV error (the
    // normal "cannot move" case, e.g. a read-only home) and cp throws too, so
    // the copy fallback cannot rescue it either.
    const brokenFs = {
      rename: async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }) },
      cp: async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }) },
    }

    // Must not throw: a failed migration may cost the new location, never the
    // plugin (which would take the picker's UI down with it).
    const migrated = await migrateLegacyDataDir({ env: { DSH_HOME: home }, fs: brokenFs })
    assert.equal(migrated, false)

    // And the fallback is the legacy directory, so this run still sees the
    // user's real state and settings.
    assert.equal(resolvePluginDataDir({ env: { DSH_HOME: home } }), legacy)
    assert.deepEqual(await readSettingsFile(resolvePluginDataDir({ env: { DSH_HOME: home } })), { enabled: false })
  })
})

test('a cross-device move falls back to copy-then-delete', async () => {
  await withTempDir(async (home) => {
    await seedLegacy(home)
    const calls = []
    const fakeFs = {
      rename: async (from, to) => {
        calls.push(['rename', from, to])
        throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' })
      },
      cp: async (from, to, options) => { calls.push(['cp', from, to, options]); return cp(from, to, options) },
    }

    const migrated = await migrateLegacyDataDir({ env: { DSH_HOME: home }, fs: fakeFs })
    assert.equal(migrated, true)
    // EXDEV is the one error worth retrying as a copy — and the copy must be
    // recursive, because the payload is a directory.
    assert.deepEqual(
      calls[0],
      ['rename', resolveLegacyDataDir({ env: { DSH_HOME: home } }), resolveDataDir({ env: { DSH_HOME: home } })],
    )
    assert.equal(calls[1][0], 'cp')
    assert.equal(calls[1][3]?.recursive, true)
    assert.deepEqual(await readSettingsFile(resolveDataDir({ env: { DSH_HOME: home } })), { enabled: false })
    await assert.rejects(stat(resolveLegacyDataDir({ env: { DSH_HOME: home } })))
  })
})

test('a target that appears mid-copy is never deleted', async () => {
  await withTempDir(async (home) => {
    await seedLegacy(home)
    const current = resolveDataDir({ env: { DSH_HOME: home } })
    const marker = join(current, 'someone-elses.json')
    const fakeFs = {
      rename: async () => {
        throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' })
      },
      // Simulate a race: another process created the target between our check
      // and our copy, so `cp` refuses to write over it.
      cp: async () => {
        await mkdir(current, { recursive: true })
        await writeFile(marker, 'do not delete me')
        throw Object.assign(new Error('cp: dest exists'), { code: 'ERR_FS_CP_EEXIST' })
      },
    }

    assert.equal(await migrateLegacyDataDir({ env: { DSH_HOME: home }, fs: fakeFs }), false)
    // The loser of the race must not clean up after the winner.
    assert.equal(await readFile(marker, 'utf8'), 'do not delete me')
  })
})

test('the Host migrates before it reads any state', async () => {
  const { apply, TELEMETRY_SETTINGS_PATH } = await import('../index.js')
  const routes = []
  await withTempDir(async (home) => {
    // A legacy directory the user has opted out in. If the route or the
    // heartbeat read before migrating, they would read this file from the old
    // path — and the assertions below would see it in the wrong place.
    await seedLegacy(home, { settings: serializeSettings({ enabled: false }) })
    const originalHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => ({ ok: true, status: 202 })
    try {
      apply({
        get: name => (name === 'webServer' ? { register: r => { routes.push(r); return () => {} } } : undefined),
        effect: fn => fn(),
        logger: { warn: () => {} },
      })
      const route = routes.find(item => item.path === TELEMETRY_SETTINGS_PATH)
      const answer = await invokeTelemetry(route, 'GET')
      assert.deepEqual(JSON.parse(answer.body), { ok: true, enabled: false })
      // The choice was read from the NEW location, which only holds it because
      // the migration ran first.
      assert.deepEqual(await readSettingsFile(resolveDataDir()), { enabled: false })
      await assert.rejects(stat(resolveLegacyDataDir()))
    } finally {
      globalThis.fetch = originalFetch
      if (originalHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = originalHome
    }
  })
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
    const state = JSON.parse(await readFile(join(dir, 'plugins', DATA_DIR_NAME, STATE_FILE), 'utf8'))
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

// ---------------------------------------------------------------------------
// Telemetry toggle (DEC-035): the user's off switch, honoured by the Host.
// ---------------------------------------------------------------------------

test('telemetry settings default to enabled and survive a round-trip', () => {
  // Absent = enabled: the collection is opt-out, so a machine whose owner
  // never opened Settings must keep reporting exactly as before.
  assert.deepEqual(parseSettings(''), { enabled: true })
  assert.deepEqual(parseSettings(undefined), { enabled: true })
  // Any corruption degrades to enabled, never to silent — losing a day of
  // statistics to a damaged file is the wrong failure direction.
  for (const bad of ['{', '[]', 'null', '"x"', '{"enabled":"no"}']) {
    assert.deepEqual(parseSettings(bad), { enabled: true }, `input ${bad}`)
  }
  // Only an explicit `false` turns it off.
  assert.deepEqual(parseSettings('{"enabled":false}'), { enabled: false })
  assert.deepEqual(parseSettings('{"enabled":true}'), { enabled: true })
  // Round-trip keeps the file hand-readable.
  assert.equal(serializeSettings({ enabled: false }), '{\n  "enabled": false\n}\n')
  assert.deepEqual(parseSettings(serializeSettings({ enabled: true })), { enabled: true })
})

test('the settings file reads and writes atomically in the data directory', async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(await readSettingsFile(dir), { enabled: true }, 'a missing file reads as enabled')
    await writeSettingsFile(dir, { enabled: false })
    const onDisk = JSON.parse(await readFile(join(dir, SETTINGS_FILE), 'utf8'))
    assert.equal(onDisk.enabled, false)
    assert.deepEqual(await readSettingsFile(dir), { enabled: false })
    // 0600, like the state file: a local choice is nobody else's business.
    const fileStat = await stat(join(dir, SETTINGS_FILE))
    assert.equal(fileStat.mode & 0o777, 0o600)
  })
})

test('an opted-out reporter sends nothing and writes no state', async () => {
  await withTempDir(async (dir) => {
    const { impl, calls } = stubFetch()
    const reporter = new TelemetryReporter({
      dir,
      pluginId: PLUGIN,
      fetchImpl: impl,
      clock: () => DAY_ONE,
      enabled: false,
    })
    assert.equal(reporter.enabled, false)
    const result = await reporter.start({ version: '1.2.3', platform: 'darwin', arch: 'arm64' })
    // Nothing sent, and crucially no state file: an opted-out machine must not
    // leave `lastAttemptDay` behind, so re-enabling tomorrow reports a clean
    // install/heartbeat rather than resuming a half-written one.
    assert.equal(result.sent, false)
    assert.equal(calls().length, 0)
    await assert.rejects(stat(join(dir, STATE_FILE)))
    // The default is enabled — the opt-out default keeps existing machines reporting.
    const on = new TelemetryReporter({ dir, pluginId: PLUGIN, fetchImpl: impl, clock: () => DAY_ONE })
    assert.equal(on.enabled, true)
  })
})

/** Invoke one telemetry-settings route handler with a request body. */
async function invokeTelemetry(route, method, body) {
  let captured = null
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(output) { captured = { status: this.statusCode, headers: this.headers, body: output } },
  }
  const req = {
    method,
    [Symbol.asyncIterator]: async function* () {
      if (body !== undefined) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    },
  }
  await route.handler(req, res)
  return captured
}

test('the telemetry-settings route answers GET with the current choice', async () => {
  const { apply, TELEMETRY_SETTINGS_PATH } = await import('../index.js')
  assert.equal(typeof TELEMETRY_SETTINGS_PATH, 'string')
  const routes = []
  await withTempDir(async (dir) => {
    // resolveDataDir() = $DSH_HOME/plugins/dsh-model-flatmap, created on write.
    process.env.DSH_HOME = dir
    const home = process.env.DSH_HOME
    try {
      apply({
        get: name => (name === 'webServer' ? { register: r => { routes.push(r); return () => {} } } : undefined),
        effect: fn => fn(),
        logger: { warn: () => {} },
      })
      const route = routes.find(item => item.path === TELEMETRY_SETTINGS_PATH)
      assert.notEqual(route, undefined, 'the telemetry-settings route is registered')
      // Default (no file yet): enabled.
      const first = await invokeTelemetry(route, 'GET')
      assert.equal(first.status, 200)
      assert.deepEqual(JSON.parse(first.body), { ok: true, enabled: true })
      // After an opted-out write, GET reports it.
      await writeSettingsFile(resolveDataDir(), { enabled: false })
      const second = await invokeTelemetry(route, 'GET')
      assert.deepEqual(JSON.parse(second.body), { ok: true, enabled: false })
    } finally {
      if (process.env.DSH_HOME === home) delete process.env.DSH_HOME
    }
  })
})

test('the telemetry-settings route writes a POSTed choice and rejects bad bodies', async () => {
  const { apply, TELEMETRY_SETTINGS_PATH } = await import('../index.js')
  const routes = []
  await withTempDir(async (dir) => {
    process.env.DSH_HOME = dir
    const home = process.env.DSH_HOME
    try {
      apply({
        get: name => (name === 'webServer' ? { register: r => { routes.push(r); return () => {} } } : undefined),
        effect: fn => fn(),
        logger: { warn: () => {} },
      })
      const route = routes.find(item => item.path === TELEMETRY_SETTINGS_PATH)
      // A valid POST persists the choice and echoes it back.
      const posted = await invokeTelemetry(route, 'POST', { enabled: false })
      assert.equal(posted.status, 200)
      assert.deepEqual(JSON.parse(posted.body), { ok: true, enabled: false })
      assert.deepEqual(await readSettingsFile(resolveDataDir()), { enabled: false })
      // Malformed bodies are a 400, never a silent coercion: this file gates a
      // real network send, so an ambiguous write must not be guessed at.
      for (const bad of ['{', '{"enabled":"yes"}', '{"enabled":1}', '[]', 'null']) {
        const answer = await invokeTelemetry(route, 'POST', bad)
        assert.equal(answer.status, 400, `bad body ${bad}`)
      }
      // A write that did not happen leaves the previous choice intact.
      assert.deepEqual(await readSettingsFile(resolveDataDir()), { enabled: false })
      // Methods it does not own are a 405.
      const put = await invokeTelemetry(route, 'PUT', { enabled: true })
      assert.equal(put.status, 405)
      assert.equal(put.headers.allow, 'GET, HEAD, POST')
    } finally {
      if (process.env.DSH_HOME === home) delete process.env.DSH_HOME
    }
  })
})

// ---------------------------------------------------------------------------
// The teamwork DEFAULT actually applies (DEC-063).
//
// Two defects made the Settings toggle decorative: nothing read the preference,
// and it lived in `localStorage`, which the Desktop GUI loses on every restart
// because its port — and therefore the origin — changes. The preference now
// lives in `config.yaml`, and the Host applies it on `agent/created`, which runs
// BEFORE the Session's first model step.
//
// The Host is the only place this can work: the Team projection's client view
// always reports `enabled` as a boolean, so the browser cannot distinguish
// "nobody chose" from "chose off". The durable event log can.
// ---------------------------------------------------------------------------

/** A fake Host context that records the events the plugin subscribes to. */
function teamHost(options = {}) {
  const handlers = new Map()
  const calls = []
  const teams = options.noService === true ? undefined : {
    setEnabled: async (agent, enabled) => { calls.push([agent, enabled]); return undefined },
  }
  const services = { agentTeams: teams }
  return {
    calls,
    handlers,
    ctx: {
      get: name => services[name],
      effect: fn => fn(),
      logger: { warn: () => {} },
      on: (type, handler) => {
        handlers.set(type, handler)
        return () => { handlers.delete(type) }
      },
    },
  }
}

/** A fake live root agent; `events` are the ones its log already holds. */
function fakeAgent(events = [], origin) {
  return {
    session: {
      header: { origin },
      inheritedEventCount: 0,
      ownEvents: () => events,
    },
  }
}

/**
 * Run the teamwork-default installer against a temp home.
 *
 * The installer is called directly rather than through `apply()`: `apply()` also
 * fires the heartbeat, whose background write would race this cleanup. The one
 * test that does go through `apply()` tolerates that.
 */
async function withTeamHost(preference, run) {
  const { installTeamDefault } = await import('../index.js')
  await withTempDir(async (dir) => {
    const home = process.env.DSH_HOME
    try {
      process.env.DSH_HOME = dir
      const written = await import('../config.js')
      if (preference !== undefined) {
        writeConfigFile(written.resolveConfigFile(),
          { hidden: new Set(), aliases: new Map(), teamDefault: preference })
      }
      const host = teamHost()
      installTeamDefault(host.ctx)
      const created = host.handlers.get('agent/created')
      assert.equal(typeof created, 'function', 'the Host subscribes to agent creation')
      return await run({ created, host, dir })
    } finally {
      if (process.env.DSH_HOME === home) delete process.env.DSH_HOME
    }
  })
}

test('a new root Session gets teamwork on when the preference is on', async () => {
  await withTeamHost(true, async ({ created, host }) => {
    const agent = fakeAgent([])
    await created({ agent, source: 'startup' })
    assert.equal(host.calls.length, 1, 'the default is written')
    assert.equal(host.calls[0][0], agent, 'for this Session')
    assert.equal(host.calls[0][1], true, 'and it says on')
  })
})

test('a preference that is off writes nothing', async () => {
  await withTeamHost(false, async ({ created, host }) => {
    await created({ agent: fakeAgent([]), source: 'startup' })
    assert.deepEqual(host.calls, [], 'off is the absence of a write, not a write of false')
  })
})

test('no config file at all means off, like the host default', async () => {
  await withTeamHost(undefined, async ({ created, host }) => {
    await created({ agent: fakeAgent([]), source: 'startup' })
    assert.deepEqual(host.calls, [], 'a machine that never configured it gets the host default')
  })
})

test('a Session that already saved a selection is never overridden', async () => {
  // This is the case the browser CANNOT see: the wire view renders a saved
  // "off" and "never chosen" identically. Overriding an explicit opt-out is
  // worse than not applying the default, so the check runs on the event log.
  for (const enabled of [false, true]) {
    await withTeamHost(true, async ({ created, host }) => {
      const saved = [{ type: 'team/mode', seq: 3, data: { enabled } }]
      await created({ agent: fakeAgent(saved), source: 'startup' })
      assert.deepEqual(host.calls, [], `an explicit ${String(enabled)} is left alone`)
    })
  }
})

test('a resumed Session keeps whatever it had', async () => {
  await withTeamHost(true, async ({ created, host }) => {
    await created({ agent: fakeAgent([]), source: 'resume' })
    assert.deepEqual(host.calls, [], 'resuming never applies the default')
    await created({ agent: fakeAgent([]), source: 'compact' })
    assert.deepEqual(host.calls, [], 'nor does compaction')
  })
})

test('a subagent never gets the default applied', async () => {
  // `setEnabled` refuses a descendant outright, so attempting it would only
  // produce a rejected promise on every child activation.
  await withTeamHost(true, async ({ created, host }) => {
    await created({ agent: fakeAgent([], 'subagent'), source: 'startup' })
    assert.deepEqual(host.calls, [], 'children share their root selection')
  })
})

test('a team/mode inherited from a fork is not this Session\'s choice', async () => {
  await withTeamHost(true, async ({ created, host }) => {
    const inherited = [{ type: 'team/mode', seq: 1, data: { enabled: false } }]
    const agent = {
      session: {
        header: {},
        inheritedEventCount: 5,
        ownEvents: () => inherited,
      },
    }
    await created({ agent, source: 'startup' })
    assert.equal(host.calls.length, 1, 'a forked event below the watermark does not count as saved')
  })
})

test('a Host without the Team service is left alone', async () => {
  await withTeamHost(true, async ({ created }) => {
    const host = teamHost({ noService: true })
    const { installTeamDefault } = await import('../index.js')
    installTeamDefault(host.ctx)
    await assert.doesNotReject(host.handlers.get('agent/created')({ agent: fakeAgent([]), source: 'startup' }),
      'a composition without Agent Teams must not fault')
    assert.equal(typeof created, 'function')
  })
})

test('apply() installs the teamwork default alongside the other Host jobs', async () => {
  // Pins the wiring, which the direct-call tests above deliberately bypass.
  //
  // The state file is pre-seeded with today's attempt so the activation
  // heartbeat decides "already done today" and performs NO write. Without that
  // its fire-and-forget write outlives the test and races the cleanup.
  const { apply } = await import('../index.js')
  await withTempDir(async (dir) => {
    const home = process.env.DSH_HOME
    try {
      process.env.DSH_HOME = dir
      const today = shanghaiDay(Date.parse('2026-11-14T02:00:00Z'))
      await mkdir(join(resolveDataDir(), '..'), { recursive: true })
      await mkdir(resolveDataDir(), { recursive: true })
      await writeFile(join(resolveDataDir(), STATE_FILE), serializeState({
        installId: newInstallId(),
        firstRunAt: Date.parse('2026-11-13T02:00:00Z'),
        firstVersion: PLUGIN,
        lastSentDay: today,
        lastAttemptDay: today,
        lastOkDay: today,
        failures: 0,
        degraded: false,
      }))
      const events = []
      apply({
        get: () => undefined,
        effect: fn => fn(),
        logger: { warn: () => {} },
        on: type => { events.push(type); return () => {} },
      })
      assert.ok(events.includes('agent/created'), 'the subscription is made on activation')
    } finally {
      if (process.env.DSH_HOME === home) delete process.env.DSH_HOME
    }
  })
})

test('an unreadable event log leaves the selection alone', async () => {
  // Reading a broken log as "no choice" would turn teamwork back on for a user
  // who switched it off — the exact override the event check exists to prevent.
  await withTeamHost(true, async ({ created, host }) => {
    const agent = {
      session: {
        header: {},
        inheritedEventCount: 0,
        ownEvents() { throw new Error('log unavailable') },
      },
    }
    await created({ agent, source: 'startup' })
    assert.deepEqual(host.calls, [], 'an unknown selection is not treated as absent')
  })
})
