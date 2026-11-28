/**
 * Tests for the config route: the bridge between the browser's switches and the
 * config file on disk.
 *
 * The shape is deliberately the same as the telemetry-settings route (DEC-035):
 * the toggle lives in the browser, the file lives on disk, so one route carries
 * the choice each way. What differs is that this file is the SOURCE OF TRUTH
 * rather than a mirror — a hand-edit of `config.yaml` must win over whatever the
 * browser last cached, which is the whole reason the user asked for the file.
 *
 * The failure modes worth pinning:
 *
 *   - a GET that reports the browser's stale cache instead of the file;
 *   - a POST that accepts a shape the file cannot represent;
 *   - a route that lets a web page flip this machine's model visibility.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { readConfigFile, writeConfigFile } from '../config.js'

/** Run `fn` against a fresh temp directory, then remove it. */
async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-flatmap-config-route-'))
  try {
    return await fn(dir)
  } finally {
    // `apply()` fires the heartbeat with `void`, so a state file can land while
    // this cleanup is running. Retrying keeps that race out of the assertions.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
}

/** Write a raw config file at the resolved path, creating its directory. */
async function writeRaw(dir, text) {
  const target = join(dir, 'dsh-model-flatmap')
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'config.yaml'), text, 'utf8')
}

/** Invoke one config route handler with a request body. */
async function invoke(route, method, body) {
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

/** Boot the Host half against a temp DSH_HOME and return its routes. */
async function boot(dir) {
  const { apply } = await import('../index.js')
  const routes = []
  process.env.DSH_HOME = dir
  apply({
    get: name => (name === 'webServer' ? { register: r => { routes.push(r); return () => {} } } : undefined),
    effect: fn => fn(),
    logger: { warn: () => {} },
  })
  return routes
}

test('the config route is registered under the package name', async () => {
  const { CONFIG_ROUTE_PATH } = await import('../index.js')
  assert.equal(CONFIG_ROUTE_PATH, '/dsh-model-flatmap/config')
  await withTempDir(async (dir) => {
    const home = process.env.DSH_HOME
    try {
      const routes = await boot(dir)
      const route = routes.find(item => item.path === CONFIG_ROUTE_PATH)
      assert.notEqual(route, undefined, 'the config route is registered')
    } finally {
      if (process.env.DSH_HOME === home) delete process.env.DSH_HOME
    }
  })
})

test('GET answers the file, and a hand-edit wins over anything cached', async () => {
  const { CONFIG_ROUTE_PATH } = await import('../index.js')
  await withTempDir(async (dir) => {
    const home = process.env.DSH_HOME
    try {
      const routes = await boot(dir)
      const route = routes.find(item => item.path === CONFIG_ROUTE_PATH)

      // No file yet: the built-in defaults.
      const first = await invoke(route, 'GET')
      assert.equal(first.status, 200)
      assert.deepEqual(JSON.parse(first.body),
        { ok: true, hidden: [], aliases: {}, teamDefault: false },
        'the built-in default for the teamwork preference is off, like the host')

      // The user edits the file by hand. The route must report THAT, because
      // the file is the source of truth — this is the whole point of the change.
      await writeRaw(dir, 'hidden:\n  - p\nteamDefault: true\n')
      const second = await invoke(route, 'GET')
      assert.deepEqual(JSON.parse(second.body),
        { ok: true, hidden: ['p'], aliases: {}, teamDefault: true },
        'a hand-written teamDefault is reported too, not just the two record sections')
    } finally {
      if (process.env.DSH_HOME === home) delete process.env.DSH_HOME
    }
  })
})

test('POST writes the file and echoes what was stored', async () => {
  const { CONFIG_ROUTE_PATH } = await import('../index.js')
  await withTempDir(async (dir) => {
    const home = process.env.DSH_HOME
    try {
      const routes = await boot(dir)
      const route = routes.find(item => item.path === CONFIG_ROUTE_PATH)
      const posted = await invoke(route, 'POST', {
        hidden: ['p', 'p/m'],
        aliases: { p: '第三方' },
      })
      assert.equal(posted.status, 200)
      const body = JSON.parse(posted.body)
      assert.equal(body.ok, true)
      assert.deepEqual(body.hidden.sort(), ['p', 'p/m'])
      assert.equal(body.aliases.p, '第三方')
      // And it really landed on disk in the documented shape.
      const onDisk = readConfigFile(join(dir, 'dsh-model-flatmap', 'config.yaml'))
      assert.deepEqual([...onDisk.hidden].sort(), ['p', 'p/m'])
      assert.equal(onDisk.aliases.get('p'), '第三方')
    } finally {
      if (process.env.DSH_HOME === home) delete process.env.DSH_HOME
    }
  })
})

test('POST rejects a body the file cannot represent', async () => {
  const { CONFIG_ROUTE_PATH } = await import('../index.js')
  await withTempDir(async (dir) => {
    const home = process.env.DSH_HOME
    try {
      const routes = await boot(dir)
      const route = routes.find(item => item.path === CONFIG_ROUTE_PATH)
      const bad = [
        '{',
        'null',
        '[]',
        '{"hidden":"p"}',
        '{"hidden":[1,2]}',
        '{"aliases":"p"}',
        '{"aliases":{"p":1}}',
        '{"unknown":[]}',
        '{"teamDefault":"yes"}',
        '{"teamDefault":1}',
      ]
      for (const body of bad) {
        const answer = await invoke(route, 'POST', body)
        assert.equal(answer.status, 400, `bad body ${body}`)
      }
      // A rejected write leaves the previous state untouched.
      assert.deepEqual(JSON.parse((await invoke(route, 'GET')).body),
        { ok: true, hidden: [], aliases: {}, teamDefault: false })
    } finally {
      if (process.env.DSH_HOME === home) delete process.env.DSH_HOME
    }
  })
})

test('a corrupt config file is reported, not silently reset', async () => {
  const { CONFIG_ROUTE_PATH } = await import('../index.js')
  await withTempDir(async (dir) => {
    const home = process.env.DSH_HOME
    try {
      const routes = await boot(dir)
      const route = routes.find(item => item.path === CONFIG_ROUTE_PATH)
      await writeRaw(dir, 'hidden: yes\n')
      const answer = await invoke(route, 'GET')
      // 500 with an explanation: the browser must be able to tell the user their
      // file is broken instead of showing them an empty, "unconfigured" panel.
      assert.equal(answer.status, 500)
      const body = JSON.parse(answer.body)
      assert.equal(body.ok, false)
      assert.match(String(body.error), /config|yaml/i)
    } finally {
      if (process.env.DSH_HOME === home) delete process.env.DSH_HOME
    }
  })
})

test('the route refuses methods it does not own', async () => {
  const { CONFIG_ROUTE_PATH } = await import('../index.js')
  await withTempDir(async (dir) => {
    const home = process.env.DSH_HOME
    try {
      const routes = await boot(dir)
      const route = routes.find(item => item.path === CONFIG_ROUTE_PATH)
      const put = await invoke(route, 'PUT', { hidden: [] })
      assert.equal(put.status, 405)
      assert.equal(put.headers.allow, 'GET, HEAD, POST')
    } finally {
      if (process.env.DSH_HOME === home) delete process.env.DSH_HOME
    }
  })
})

test('the route fails closed when the connection fence cannot answer', async () => {
  const { apply, CONFIG_ROUTE_PATH } = await import('../index.js')
  await withTempDir(async (dir) => {
    const home = process.env.DSH_HOME
    process.env.DSH_HOME = dir
    try {
      const routes = []
      apply({
        get: name => {
          if (name === 'webServer') return { register: r => { routes.push(r); return () => {} } }
          if (name === 'connection') {
            return { requestRejection: () => { throw new Error('fence broken') } }
          }
          return undefined
        },
        effect: fn => fn(),
        logger: { warn: () => {} },
      })
      const route = routes.find(item => item.path === CONFIG_ROUTE_PATH)
      const answer = await invoke(route, 'GET')
      // A fence that cannot answer must not open the route: this file decides
      // which models the machine shows.
      assert.equal(answer.status, 403)
    } finally {
      if (process.env.DSH_HOME === home) delete process.env.DSH_HOME
    }
  })
})

test('the route honours a fence that rejects', async () => {
  const { apply, CONFIG_ROUTE_PATH } = await import('../index.js')
  await withTempDir(async (dir) => {
    const home = process.env.DSH_HOME
    process.env.DSH_HOME = dir
    try {
      const routes = []
      apply({
        get: name => {
          if (name === 'webServer') return { register: r => { routes.push(r); return () => {} } }
          if (name === 'connection') return { requestRejection: () => 401 }
          return undefined
        },
        effect: fn => fn(),
        logger: { warn: () => {} },
      })
      const route = routes.find(item => item.path === CONFIG_ROUTE_PATH)
      assert.equal((await invoke(route, 'GET')).status, 401)
    } finally {
      if (process.env.DSH_HOME === home) delete process.env.DSH_HOME
    }
  })
})

test('a pre-existing config survives a POST that only touches aliases', async () => {
  const { CONFIG_ROUTE_PATH } = await import('../index.js')
  await withTempDir(async (dir) => {
    const home = process.env.DSH_HOME
    try {
      const routes = await boot(dir)
      const route = routes.find(item => item.path === CONFIG_ROUTE_PATH)
      writeConfigFile(join(dir, 'dsh-model-flatmap', 'config.yaml'), {
        hidden: new Set(['p']),
        aliases: new Map([['p', 'Old']]),
      })
      // The browser always posts the FULL record, so a partial post is not a
      // merge — it is the new truth. Pinning that keeps the two halves from
      // disagreeing about whether a POST is a patch or a replace.
      const posted = await invoke(route, 'POST', { hidden: ['p'], aliases: { p: 'New' } })
      assert.equal(posted.status, 200)
      const onDisk = readConfigFile(join(dir, 'dsh-model-flatmap', 'config.yaml'))
      assert.equal(onDisk.aliases.get('p'), 'New')
      assert.deepEqual([...onDisk.hidden], ['p'])
    } finally {
      if (process.env.DSH_HOME === home) delete process.env.DSH_HOME
    }
  })
})

test('the route is registered when the web server arrives AFTER activation', async () => {
  const { apply, CONFIG_ROUTE_PATH } = await import('../index.js')
  await withTempDir(async (dir) => {
    const home = process.env.DSH_HOME
    process.env.DSH_HOME = dir
    try {
      const routes = []
      let deferred
      const ctx = {
        // Nothing is mounted yet: this is exactly the real startup order that
        // made the route disappear. A one-shot lookup here finds `undefined`,
        // and every later GET/POST answers 404 for the life of the process.
        get: () => undefined,
        effect: fn => fn(),
        inject: (names, callback) => { deferred = { names, callback } },
        logger: { warn: () => {} },
      }
      apply(ctx)
      assert.equal(routes.length, 0, 'nothing can be registered before the server exists')
      assert.notEqual(deferred, undefined,
        'apply() must ask to be told when the web server mounts, instead of giving up')
      assert.deepEqual(deferred.names, ['webServer'])

      // The server mounts. The route must appear now, with no restart.
      const webCtx = {
        get: name => (name === 'webServer' ? { register: (r) => { routes.push(r); return () => {} } } : undefined),
        effect: fn => fn(),
      }
      deferred.callback(webCtx)
      assert.notEqual(routes.find(item => item.path === CONFIG_ROUTE_PATH), undefined,
        'a late web server still gets the config route')
    } finally {
      if (process.env.DSH_HOME === home) delete process.env.DSH_HOME
    }
  })
})

test('a POST from an older browser keeps the file s teamwork default', async () => {
  const { CONFIG_ROUTE_PATH } = await import('../index.js')
  await withTempDir(async (dir) => {
    const home = process.env.DSH_HOME
    try {
      const routes = await boot(dir)
      const route = routes.find(item => item.path === CONFIG_ROUTE_PATH)
      // The user turned the default on by hand, then an older browser build —
      // one that knows only the two record sections — saves a visibility change.
      await writeRaw(dir, 'hidden: []\nteamDefault: true\n')
      const posted = await invoke(route, 'POST', { hidden: ['p'], aliases: {} })
      assert.equal(posted.status, 200)
      const onDisk = readConfigFile(join(dir, 'dsh-model-flatmap', 'config.yaml'))
      assert.equal(onDisk.teamDefault, true,
        'an absent field means "this build says nothing", never "switch it off"')
      assert.deepEqual([...onDisk.hidden], ['p'])
    } finally {
      if (process.env.DSH_HOME === home) delete process.env.DSH_HOME
    }
  })
})
