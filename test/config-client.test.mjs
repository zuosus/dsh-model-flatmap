/**
 * Tests for the browser half of the config file (DEC-060).
 *
 * The contract this pins: `config.yaml` is the ONLY source of truth, and
 * `localStorage` does not participate. The browser cannot read a file, so the
 * panel starts from the built-in defaults and adopts the file's record once the
 * Host answers — but nothing is ever read from or written to `localStorage` for
 * the visibility switches or the provider renames.
 *
 * Failure modes worth pinning:
 *
 *   - a Host read that never reaches the file (the panel silently shows the
 *     defaults, the honest fallback when the only source is unreachable);
 *   - a corrupt file read as "nothing hidden" (models come back unexplained);
 *   - a local write that never reaches the file (the file silently drifts);
 *   - any storage access at all (the file is the only source, so storage access
 *     is a regression).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

// ---------------------------------------------------------------------------
// Minimal hook runtime: copied from render.test.mjs so this file can load the
// bundle without a browser. Only the pieces the bundle touches at load time.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
function createRuntime() {
  const hooks = []
  let cursor = 0
  let rerender = null
  // Effects are queued on every render but only run when a test explicitly
  // flushes them. Existing tests never flush, so their behavior is unchanged;
  // tests for mount-time reads (the Settings catalogue) can flush on demand.
  const pendingEffects = []
  class RComponent {
    constructor(props) { this.props = props; this.state = {} }
    setState(next) { this.state = { ...this.state, ...(typeof next === 'function' ? next(this.state) : next) } }
  }
  const React = {
    Component: RComponent,
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useId: () => 'test',
    useRef: value => {
      const slot = cursor++
      hooks[slot] ??= { current: value }
      return hooks[slot]
    },
    useState: initial => {
      const slot = cursor++
      // React treats a function initializer as a LAZY one and calls it on the
      // first render only. Mirroring that keeps a component's lazy state
      // (a Set, a Map) usable here instead of storing the factory itself.
      if (hooks[slot] === undefined) {
        hooks[slot] = { value: typeof initial === 'function' ? initial() : initial }
      }
      const box = hooks[slot]
      return [box.value, next => {
        box.value = typeof next === 'function' ? next(box.value) : next
        rerender?.()
      }]
    },
    useMemo: (factory, deps) => {
      const slot = cursor++
      const previous = hooks[slot]
      if (previous !== undefined && sameDeps(previous.deps, deps)) return previous.value
      const value = factory()
      hooks[slot] = { value, deps }
      return value
    },
    useCallback: (fn, deps) => {
      const slot = cursor++
      const previous = hooks[slot]
      if (previous !== undefined && sameDeps(previous.deps, deps)) return previous.value
      hooks[slot] = { value: fn, deps }
      return fn
    },
    useEffect: (effect, deps) => {
      const slot = cursor++
      const previous = hooks[slot]
      if (previous === undefined || !sameDeps(previous.deps, deps)) pendingEffects.push(() => effect())
      hooks[slot] = { deps }
    },
    useLayoutEffect: () => { cursor += 1 },
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  }
  return {
    React,
    render(component, props) {
      // The component portals its panel to `document.body`; the stub keeps that
      // path exercisable without a DOM.
      globalThis.document = STUB_DOM
      try {
        cursor = 0
        return component(props)
      } finally {
        delete globalThis.document
      }
    },
    setRerender(fn) { rerender = fn },
    /** Run the effects queued by renders since the last flush. */
    flushEffects() {
      const queued = pendingEffects.splice(0)
      return Promise.all(queued.map(run => run()))
    },
    /** Drop every hook slot so each test starts from a clean component state. */
    reset() {
      hooks.length = 0
      pendingEffects.length = 0
      cursor = 0
      rerender = null
    },
  }
}


// ---------------------------------------------------------------------------
// Bundle loading
// ---------------------------------------------------------------------------
const STUB_DOM = {
  querySelector: () => ({}),
  createElement: () => ({ dataset: {}, textContent: '' }),
  head: { append() {} },
}

function materialize() {
  let registration
  globalThis.window = { __ModuleLoader__: { load: value => { registration = value } } }
  globalThis.document = STUB_DOM
  try {
    // eslint-disable-next-line no-new-func
    new Function(source)()
  } finally {
    delete globalThis.window
    delete globalThis.document
  }
  return registration.factory(specifier => {
    if (specifier === 'react') return runtime.React
    if (specifier === 'react-dom') return { createPortal: node => node }
    throw new Error(`unexpected require: ${specifier}`)
  })
}

const runtime = createRuntime()
const bundle = materialize()
const api = bundle.__test

/** A localStorage stub that records every access, to prove the feature never
 * touches storage: the file is the only source of truth. */
function installRecordingStorage() {
  const accesses = []
  globalThis.localStorage = {
    getItem: key => { accesses.push(['get', key]); return null },
    setItem: (key, value) => { accesses.push(['set', key, value]) },
    removeItem: key => { accesses.push(['remove', key]) },
  }
  return accesses
}

/** A fetch stub that answers one canned response and records the calls. */
function stubFetch(answer) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    if (typeof answer === 'function') return answer(url, init)
    return answer
  }
  return { impl, calls }
}

/** A JSON response shape the code can read. */
function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

// ---------------------------------------------------------------------------
// Reading the route's answer
// ---------------------------------------------------------------------------

test('a config payload parses into a hidden set and an alias map', () => {
  const parsed = api.parseConfigPayload({ ok: true, hidden: ['p', 'p/m'], aliases: { p: '第三方' } })
  assert.deepEqual([...parsed.hidden].sort(), ['p', 'p/m'])
  assert.equal(parsed.aliases.get('p'), '第三方')
})

test('a payload with missing sections is the default, not an error', () => {
  const parsed = api.parseConfigPayload({ ok: true })
  assert.equal(parsed.hidden.size, 0)
  assert.equal(parsed.aliases.size, 0)
})

test('a malformed payload is rejected rather than read as empty', () => {
  const bad = [
    null,
    'text',
    [],
    { ok: false },
    { ok: true, hidden: 'p' },
    { ok: true, hidden: [1] },
    { ok: true, aliases: [] },
    { ok: true, aliases: { p: 1 } },
  ]
  for (const payload of bad) {
    assert.equal(api.parseConfigPayload(payload), null, `payload ${JSON.stringify(payload)}`)
  }
})

// ---------------------------------------------------------------------------
// The file is the ONLY source of truth
// ---------------------------------------------------------------------------

test('a Host read returns the file record and never touches localStorage', async () => {
  const accesses = installRecordingStorage()
  try {
    const { impl } = stubFetch(jsonResponse({ ok: true, hidden: ['new'], aliases: { p: 'FromFile' } }))
    const result = await api.loadConfigFromHost({ fetchImpl: impl })
    assert.equal(result.status, 'ready')
    assert.deepEqual([...result.hidden], ['new'], 'the file wins')
    assert.equal(result.aliases.get('p'), 'FromFile')
    assert.deepEqual(accesses, [], 'the file read touches no storage')
  } finally {
    delete globalThis.localStorage
  }
})

test('the store adopts a file record without touching localStorage', () => {
  const accesses = installRecordingStorage()
  try {
    const face = api.createHiddenStore({})
    face.adopt(new Set(['p', 'p/m']))
    assert.deepEqual([...face.getSnapshot()].sort(), ['p', 'p/m'])
    const aliasFace = api.createAliasStore({})
    aliasFace.adopt(new Map([['p', '第三方']]))
    assert.equal(aliasFace.getSnapshot().get('p'), '第三方')
    assert.deepEqual(accesses, [], 'an adopt writes no storage')
  } finally {
    delete globalThis.localStorage
  }
})

test('the store starts from the built-in defaults, never from storage', () => {
  const accesses = installRecordingStorage()
  try {
    const face = api.createHiddenStore({})
    assert.equal(face.getSnapshot().size, 0, 'no hidden key is read from storage')
    const aliasFace = api.createAliasStore({})
    assert.equal(aliasFace.getSnapshot().size, 0, 'no alias is read from storage')
    assert.deepEqual(accesses, [], 'construction reads no storage')
  } finally {
    delete globalThis.localStorage
  }
})

// ---------------------------------------------------------------------------
// Degrading
// ---------------------------------------------------------------------------

test('a failed Host read offers no replacement record, and touches no storage', async () => {
  const accesses = installRecordingStorage()
  try {
    const { impl } = stubFetch(async () => { throw new Error('offline') })
    const result = await api.loadConfigFromHost({ fetchImpl: impl })
    assert.equal(result.status, 'unavailable')
    assert.equal(result.hidden, undefined, 'no replacement record is offered')
    assert.deepEqual(accesses, [], 'going offline touches no storage')
  } finally {
    delete globalThis.localStorage
  }
})

test('a corrupt file is surfaced, never read as "nothing hidden"', async () => {
  installRecordingStorage()
  try {
    const { impl } = stubFetch(jsonResponse({ ok: false, error: 'config.yaml 不是合法的配置' }, false, 500))
    const result = await api.loadConfigFromHost({ fetchImpl: impl })
    assert.equal(result.status, 'broken')
    assert.match(String(result.error), /config/i)
    assert.equal(result.hidden, undefined, 'no empty record un-hides the choices')
  } finally {
    delete globalThis.localStorage
  }
})

test('a missing fetch implementation degrades to unavailable', async () => {
  installRecordingStorage()
  try {
    const result = await api.loadConfigFromHost({ fetchImpl: undefined, hasFetch: false })
    assert.equal(result.status, 'unavailable')
  } finally {
    delete globalThis.localStorage
  }
})

// ---------------------------------------------------------------------------
// Writing back
// ---------------------------------------------------------------------------

test('a local change is written to the file', async () => {
  installRecordingStorage()
  try {
    const { impl, calls } = stubFetch(jsonResponse({ ok: true, hidden: ['p'], aliases: {} }))
    const ok = await api.syncConfigToHost(
      { hidden: new Set(['p']), aliases: new Map([['p', 'Name']]) },
      { fetchImpl: impl },
    )
    assert.equal(ok, true)
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /dsh-model-flatmap\/config$/)
    assert.equal(calls[0].init.method, 'POST')
    const body = JSON.parse(calls[0].init.body)
    assert.deepEqual(body.hidden, ['p'])
    assert.equal(body.aliases.p, 'Name')
  } finally {
    delete globalThis.localStorage
  }
})

test('a failed mirror resolves false and never throws', async () => {
  installRecordingStorage()
  try {
    const { impl } = stubFetch(async () => { throw new Error('offline') })
    const ok = await api.syncConfigToHost({ hidden: new Set(['p']), aliases: new Map() }, { fetchImpl: impl })
    assert.equal(ok, false, 'the caller learns the write did not land')
  } finally {
    delete globalThis.localStorage
  }
})

test('a rejected mirror resolves false', async () => {
  installRecordingStorage()
  try {
    const { impl } = stubFetch(jsonResponse({ ok: false }, false, 400))
    const ok = await api.syncConfigToHost({ hidden: new Set(['p']), aliases: new Map() }, { fetchImpl: impl })
    assert.equal(ok, false)
  } finally {
    delete globalThis.localStorage
  }
})

// ---------------------------------------------------------------------------
// The stores carry the mirror, so a switch in Settings reaches the file
// ---------------------------------------------------------------------------

test('hiding a model through the store writes the new record to the file, not to storage', async () => {
  const accesses = installRecordingStorage()
  try {
    const { impl, calls } = stubFetch(jsonResponse({ ok: true, hidden: ['p'], aliases: {} }))
    const face = api.createHiddenStore({
      sync: record => api.syncConfigToHost({ hidden: record, aliases: new Map() }, { fetchImpl: impl }),
    })
    face.setVisible('p', false)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(calls.length, 1, 'the write reached the Host')
    assert.deepEqual(JSON.parse(calls[0].init.body).hidden, ['p'])
    assert.deepEqual(accesses, [], 'the switch wrote no storage')
  } finally {
    delete globalThis.localStorage
  }
})

test('renaming a provider through the store writes to the file, not to storage', async () => {
  const accesses = installRecordingStorage()
  try {
    const { impl, calls } = stubFetch(jsonResponse({ ok: true, hidden: [], aliases: { p: 'Name' } }))
    const face = api.createAliasStore({
      sync: aliases => api.syncConfigToHost({ hidden: new Set(), aliases }, { fetchImpl: impl }),
    })
    face.setAlias('p', 'Name')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(calls.length, 1)
    assert.equal(JSON.parse(calls[0].init.body).aliases.p, 'Name')
    assert.deepEqual(accesses, [], 'the rename wrote no storage')
  } finally {
    delete globalThis.localStorage
  }
})

test('a store with no host mirror still works, so a build without a Host half is fine', () => {
  installRecordingStorage()
  try {
    const face = api.createHiddenStore({})
    face.setVisible('p', false)
    assert.equal(face.getSnapshot().has('p'), true, 'the in-memory choice still applies')
  } finally {
    delete globalThis.localStorage
  }
})

// ---------------------------------------------------------------------------
// The localStorage persistence helpers are gone: the file is the only source
// ---------------------------------------------------------------------------

test('the hidden record no longer has a localStorage key or storage helpers', () => {
  assert.equal(api.HIDDEN_KEY, undefined, 'no dshmf:hidden key')
  assert.equal(api.readHidden, undefined, 'no readHidden')
  assert.equal(api.writeHidden, undefined, 'no writeHidden')
  assert.equal(api.ALIAS_KEY, undefined, 'no dshmf:aliases key')
  assert.equal(api.readAliases, undefined, 'no readAliases')
  assert.equal(api.writeAliases, undefined, 'no writeAliases')
})

// ---------------------------------------------------------------------------
// The route path is declared once on each side
// ---------------------------------------------------------------------------

test('the client and the Host agree on the config route path', async () => {
  const host = await import('../index.js')
  // The client fetches document-relative; the Host registers with a leading
  // slash. Two copies of one path drift silently, so pin them together.
  assert.equal(`/${api.CONFIG_ROUTE_PATH}`, host.CONFIG_ROUTE_PATH)
})
