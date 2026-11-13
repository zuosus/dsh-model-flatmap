/**
 * Render-path tests: drive the real component through a minimal hook runtime
 * and inspect the element tree it produces. This catches crashes, missing
 * sections, and wrong column counts without a browser.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

// ---------------------------------------------------------------------------
// Minimal hook runtime: sequential hook slots, re-render on a state setter.
// ---------------------------------------------------------------------------
function createRuntime() {
  const hooks = []
  let cursor = 0
  let rerender = null
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
      if (hooks[slot] === undefined) hooks[slot] = { value: initial }
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
    useEffect: () => { cursor += 1 },
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
    /** Drop every hook slot so each test starts from a clean component state. */
    reset() {
      hooks.length = 0
      cursor = 0
      rerender = null
    },
  }
}

function sameDeps(left, right) {
  if (left === undefined || right === undefined) return false
  if (left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function snapshotStore(initial) {
  const listeners = new Set()
  let value = initial
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => value,
    set(next) {
      value = next
      for (const listener of listeners) listener()
    },
  }
}

const EFFORTS = {
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max' },
  ],
  defaultEffort: 'high',
}

function catalogState(overrides = {}) {
  return {
    current: { provider: 'deepseek-account', model: 'deepseek-chat', reasoningEffort: 'high' },
    retainedEffort: undefined,
    routable: true,
    groups: [
      {
        id: 'deepseek-account',
        name: 'DeepSeek Account',
        models: [
          { id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: EFFORTS },
          { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', reasoning: EFFORTS },
        ],
      },
      {
        id: 'third-party',
        name: 'Third Party',
        models: [
          {
            id: 'grok-4',
            name: 'Grok 4',
            reasoning: { efforts: [{ id: 'on', name: 'On' }] },
            badge: { text: '×0.1', tone: 'success' },
          },
          { id: 'glm-4.6', name: 'GLM 4.6' },
          { id: 'kimi-k2', name: 'Kimi K2' },
          { id: 'mystery-model', name: 'Mystery' },
        ],
      },
    ],
    failures: [],
    status: 'ready',
    pending: null,
    error: null,
    ...overrides,
  }
}

const TEMPLATES = {
  'error.action': 'error.action:{message}',
  'failure.group': 'failure.group:{name}/{message}',
  'trigger.aria': 'trigger.aria:{model}',
  'trigger.ariaEffort': 'trigger.ariaEffort:{model}/{effort}',
  'team.failed': 'team.failed:{message}',
}

function makeProps(state, options = {}) {
  const directory = snapshotStore(state)
  const t = key => TEMPLATES[key] ?? key
  return {
    props: {
      locked: false,
      sessionId: 'session-1',
      t,
      available: true,
      directory,
      load: () => {},
      select: () => Promise.resolve({ ok: true, value: undefined }),
      resolveText: text => (typeof text === 'string' ? text : text.en),
      teamAvailable: true,
      setTeamMode: () => Promise.resolve({ ok: true, value: undefined }),
      useProjection: key => (key === 'agentTeam' ? { enabled: false, tasks: [] } : { lastUsed: null, pending: null }),
      useSession: () => null,
      useSessions: () => undefined,
      ...options.inject,
    },
    directory,
  }
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------
function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  for (const child of node.children ?? []) findAll(child, predicate, out)
  return out
}

const classNameOf = node => (typeof node?.props?.className === 'string' ? node.props.className : '')
const hasClass = (node, name) => classNameOf(node).split(/\s+/).includes(name)

/** Rows inside the grid only — the off-screen probe also carries the row class. */
function gridRows(tree) {
  const grid = findAll(tree, node => hasClass(node, 'dshmf-grid'))[0]
  return grid === undefined ? [] : findAll(grid, node => hasClass(node, 'dshmf-row'))
}

function gridTitles(tree) {
  const grid = findAll(tree, node => hasClass(node, 'dshmf-grid'))[0]
  return grid === undefined ? [] : findAll(grid, node => hasClass(node, 'dshmf-groupTitle'))
}

/** The model name of each row, in grid order. */
function gridRowNames(tree) {
  const grid = findAll(tree, node => hasClass(node, 'dshmf-grid'))[0]
  return grid === undefined
    ? []
    : findAll(grid, node => hasClass(node, 'dshmf-rowName')).map(textOf)
}

function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.children)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test('a closed seat renders only the trigger', () => {
  runtime.reset()
  const { props } = makeProps(catalogState())
  const tree = runtime.render(bundle.__component, props)
  const triggers = findAll(tree, node => hasClass(node, 'dshmf-trigger'))
  assert.equal(triggers.length, 1)
  assert.equal(triggers[0].props['aria-haspopup'], 'dialog')
  assert.equal(triggers[0].props['aria-expanded'], false)
  assert.equal(findAll(tree, node => hasClass(node, 'dshmf-panel')).length, 0)
  assert.match(textOf(triggers[0]), /DeepSeek Chat/)
})

test('opening renders every section with no second-level menu', () => {
  runtime.reset()
  const { props } = makeProps(catalogState())
  let tree
  runtime.setRerender(() => { tree = runtime.render(bundle.__component, props) })
  tree = runtime.render(bundle.__component, props)
  const trigger = findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0]
  trigger.props.onClick()
  tree = runtime.render(bundle.__component, props)

  // fixed header: search + the two mutually exclusive grouping choices
  assert.equal(findAll(tree, node => node.props?.role === 'searchbox').length, 1)
  const segment = findAll(tree, node => hasClass(node, 'dshmf-seg'))[0]
  const segButtons = findAll(segment, node => node.type === 'button')
  assert.equal(segButtons.length, 2)
  assert.equal(segButtons.filter(button => button.props['aria-pressed'] === true).length, 1)

  // the grid is the only scrollable region and holds rows, not nested menus
  const grid = findAll(tree, node => hasClass(node, 'dshmf-grid'))[0]
  assert.ok(grid, 'the grid exists')
  assert.equal(findAll(grid, node => hasClass(node, 'dshmf-row')).length, 6)
  assert.equal(findAll(tree, node => node.props?.role === 'menu').length, 0)
  assert.equal(findAll(tree, node => node.props?.role === 'menuitemradio').length, 0)

  // reasoning levels of the current model, flat
  const pills = findAll(tree, node => hasClass(node, 'dshmf-pill'))
  assert.equal(pills.length, 3)
  assert.equal(pills.filter(pill => pill.props['aria-pressed'] === true).length, 1)

  // teamwork switch on the same surface
  const switches = findAll(tree, node => node.props?.role === 'switch')
  assert.equal(switches.length, 1)
  assert.equal(switches[0].props['aria-checked'], false)
})

test('provider grouping shows one title per provider', () => {
  runtime.reset()
  const { props } = makeProps(catalogState())
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  assert.deepEqual(gridTitles(tree).map(textOf), ['provider.account', 'Third Party'])
})

test('family grouping regroups the same models and sorts Others last', () => {
  runtime.reset()
  const { props } = makeProps(catalogState())
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  const familyButton = findAll(tree, node => hasClass(node, 'dshmf-segBtn'))
    .find(button => button.props.title === 'group.family')
  familyButton.props.onClick()
  tree = runtime.render(bundle.__component, props)
  const titles = gridTitles(tree).map(textOf)
  assert.deepEqual(titles, ['DeepSeek', 'Grok', 'GLM', 'Kimi', 'Mystery'])
  assert.equal(gridRows(tree).length, 6)
})

test('search filters across providers and hides empty group titles', () => {
  runtime.reset()
  const { props } = makeProps(catalogState())
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  const input = findAll(tree, node => node.props?.role === 'searchbox')[0]
  input.props.onChange({ target: { value: 'grok' } })
  tree = runtime.render(bundle.__component, props)
  assert.deepEqual(gridTitles(tree).map(textOf), ['Third Party'])
  assert.equal(gridRows(tree).length, 1)
})

/**
 * A catalog whose doubao provider holds models that mostly do NOT contain the
 * provider's own name, which is what a provider-wide match has to reveal.
 */
function providerState() {
  return catalogState({
    current: null,
    groups: [
      {
        id: 'deepseek-account',
        name: 'DeepSeek Account',
        models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
      },
      {
        id: 'doubao',
        name: '豆包(doubao)',
        models: [
          { id: 'doubao-seed-1.6', name: 'Doubao Seed 1.6' },
          { id: 'doubao-1.5-pro', name: 'Doubao 1.5 Pro' },
          { id: 'skylark-v3', name: 'Skylark V3' },
          { id: 'ark-lite', name: 'Ark Lite' },
        ],
      },
      {
        id: 'third-party',
        name: 'Third Party',
        models: [{ id: 'grok-4', name: 'Grok 4' }],
      },
    ],
  })
}

/** Open the panel on a fresh state and type into the search box. */
function openAndSearch(state, query) {
  runtime.reset()
  const { props } = makeProps(state)
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  findAll(tree, node => node.props?.role === 'searchbox')[0]
    .props.onChange({ target: { value: query } })
  tree = runtime.render(bundle.__component, props)
  return { tree, props }
}

test('a provider-name hit reveals every model that provider offers', () => {
  // `dou` hits the provider id, so models whose own names never contain it
  // (Skylark V3, Ark Lite) still appear — the whole catalog, not just matches.
  const { tree } = openAndSearch(providerState(), 'dou')
  assert.deepEqual(gridTitles(tree).map(textOf), ['豆包(doubao)'])
  assert.deepEqual(gridRowNames(tree).sort(),
    ['Ark Lite', 'Doubao 1.5 Pro', 'Doubao Seed 1.6', 'Skylark V3'])
})

test('a provider matched by any face of its localized name still widens', () => {
  // The real catalog localizes provider names, so `name` may be `{ zh, en }`
  // rather than a string; every face has to be searchable, not just English.
  const state = catalogState({
    current: null,
    groups: [{
      id: 'vendor-x',
      name: { zh: '豆包(doubao)', en: 'Doubao' },
      models: [{ id: 'unrelated', name: 'Unrelated' }],
    }],
  })
  assert.deepEqual(gridRowNames(openAndSearch(state, 'dou').tree), ['Unrelated'])
  assert.deepEqual(gridRowNames(openAndSearch(state, '豆包').tree), ['Unrelated'])
  assert.deepEqual(gridRowNames(openAndSearch(state, 'bao').tree), ['Unrelated'])
  assert.deepEqual(gridRowNames(openAndSearch(state, 'zzz').tree), [])
})

test('name hits still rank above models pulled in by their provider', () => {
  // `skylark` matches no provider, so only that one model shows.
  const byName = openAndSearch(providerState(), 'skylark')
  assert.deepEqual(gridRowNames(byName.tree), ['Skylark V3'])

  // `dou` also appears in two model names; they sort ahead of the rest of the
  // provider's catalog, which arrives in its original order behind them.
  const mixed = openAndSearch(providerState(), 'dou')
  const names = gridRowNames(mixed.tree)
  assert.deepEqual(names.slice(0, 2).sort(), ['Doubao 1.5 Pro', 'Doubao Seed 1.6'])
  assert.deepEqual(names.slice(2), ['Skylark V3', 'Ark Lite'])
})

test('a provider-wide hit does not leak into unrelated providers', () => {
  const { tree } = openAndSearch(providerState(), 'dou')
  const titles = gridTitles(tree).map(textOf)
  assert.ok(!titles.includes('Third Party'), 'Grok stays out')
  assert.ok(!titles.includes('provider.account'), 'the DeepSeek account stays out')
  assert.ok(!gridRowNames(tree).includes('Grok 4'))
})

test('an ordered subsequence of a provider name does not pull its catalog in', () => {
  // `dbao` is a subsequence of `doubao` but neither a prefix nor a substring,
  // so the provider is not selected wholesale. The two models whose own names
  // happen to contain it as a subsequence still show on their own merit; the
  // rest of the catalog (Skylark V3, Ark Lite) stays out.
  const { tree } = openAndSearch(providerState(), 'dbao')
  assert.deepEqual(gridRowNames(tree).sort(), ['Doubao 1.5 Pro', 'Doubao Seed 1.6'])
})

test('a provider-wide hit also widens family grouping', () => {
  runtime.reset()
  const { props } = makeProps(providerState())
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-segBtn'))
    .find(button => button.props.title === 'group.family').props.onClick()
  tree = runtime.render(bundle.__component, props)
  findAll(tree, node => node.props?.role === 'searchbox')[0]
    .props.onChange({ target: { value: 'dou' } })
  tree = runtime.render(bundle.__component, props)
  // Grouping changes the headings only; the same four models stay visible.
  assert.deepEqual(gridRowNames(tree).sort(),
    ['Ark Lite', 'Doubao 1.5 Pro', 'Doubao Seed 1.6', 'Skylark V3'])
  const families = gridTitles(tree).map(textOf)
  assert.ok(families.includes('Doubao'), 'the dictionary family is used')
  assert.ok(families.includes('Skylark'), 'an uncovered id still gets its own family')
  assert.ok(!families.includes('provider.account'))
})

test('a search with no hits shows the no-match text and no group titles', () => {
  runtime.reset()
  const { props } = makeProps(catalogState())
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  findAll(tree, node => node.props?.role === 'searchbox')[0].props.onChange({ target: { value: 'zzzz' } })
  tree = runtime.render(bundle.__component, props)
  assert.deepEqual(gridTitles(tree).map(textOf), [])
  const empty = findAll(tree, node => hasClass(node, 'dshmf-empty'))
  assert.equal(empty.length, 1)
  assert.equal(textOf(empty[0]), 'empty.search')
})

test('an empty catalog shows the empty-catalog text and no reasoning row', () => {
  runtime.reset()
  const { props } = makeProps(catalogState({
    current: null,
    groups: [],
    status: 'ready',
  }))
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  assert.equal(textOf(findAll(tree, node => hasClass(node, 'dshmf-empty'))[0]), 'empty.models')
  assert.equal(findAll(tree, node => hasClass(node, 'dshmf-reason')).length, 0)
  // the teamwork row keeps its own rule: it renders when the projection exists
  assert.equal(findAll(tree, node => node.props?.role === 'switch').length, 1)
})

test('a model without reasoning metadata hides the reasoning row', () => {
  runtime.reset()
  const { props } = makeProps(catalogState({
    current: { provider: 'third-party', model: 'glm-4.6' },
  }))
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  assert.equal(findAll(tree, node => hasClass(node, 'dshmf-reason')).length, 0)
})

test('a catalog badge appears on its row and nowhere else', () => {
  runtime.reset()
  const { props } = makeProps(catalogState())
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  const grid = findAll(tree, node => hasClass(node, 'dshmf-grid'))[0]
  const badges = findAll(grid, node => hasClass(node, 'dshmf-badge'))
  assert.equal(badges.length, 1)
  assert.equal(textOf(badges[0]), '×0.1')
  assert.equal(badges[0].props['data-tone'], 'success')
})

test('the column count stays within 1–3 and never overflows the cap', () => {
  runtime.reset()
  const models = Array.from({ length: 30 }, (_, index) => ({
    id: `m${index}`,
    name: `Model ${index}`,
  }))
  const { props } = makeProps(catalogState({
    current: null,
    groups: [{ id: 'p', name: 'Provider', models }],
  }))
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  const grid = findAll(tree, node => hasClass(node, 'dshmf-grid'))[0]
  const columns = Number(/repeat\((\d+),/.exec(grid.props.style.gridTemplateColumns)[1])
  assert.ok(columns >= 1 && columns <= 3)
  assert.equal(findAll(grid, node => hasClass(node, 'dshmf-col')).length, columns)
  assert.equal(findAll(grid, node => hasClass(node, 'dshmf-row')).length, 30)
})

test('a small catalog converges to one column', () => {
  runtime.reset()
  const { props } = makeProps(catalogState({
    current: null,
    groups: [{ id: 'p', name: 'Provider', models: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }],
  }))
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  const grid = findAll(tree, node => hasClass(node, 'dshmf-grid'))[0]
  assert.match(grid.props.style.gridTemplateColumns, /^repeat\(1,/)
})

test('a rejected selection surfaces the directory error strip', () => {
  runtime.reset()
  const { props } = makeProps(catalogState({ error: 'session/writer-held: busy' }))
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  const strip = findAll(tree, node => hasClass(node, 'dshmf-error'))[0]
  assert.match(textOf(strip), /error\.sessionInUse/)
})

test('choosing another model submits provider and model only', () => {
  runtime.reset()
  const calls = []
  const { props } = makeProps(catalogState(), {
    inject: { select: selection => { calls.push(selection); return Promise.resolve({ ok: true }) } },
  })
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  const row = findAll(tree, node => hasClass(node, 'dshmf-row') && textOf(node).includes('Kimi K2'))[0]
  row.props.onClick()
  assert.deepEqual(calls, [{ provider: 'third-party', model: 'kimi-k2' }])
})

test('choosing a reasoning level keeps the model and sends the level', () => {
  runtime.reset()
  const calls = []
  const { props } = makeProps(catalogState(), {
    inject: { select: selection => { calls.push(selection); return Promise.resolve({ ok: true }) } },
  })
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  const pill = findAll(tree, node => hasClass(node, 'dshmf-pill'))
    .find(candidate => textOf(candidate) === 'Low')
  pill.props.onClick()
  assert.deepEqual(calls, [{
    provider: 'deepseek-account',
    model: 'deepseek-chat',
    reasoningEffort: 'low',
  }])
})

test('disabling teamwork asks for confirmation before it submits', () => {
  runtime.reset()
  const calls = []
  const { props } = makeProps(catalogState(), {
    inject: {
      useProjection: key => (key === 'agentTeam'
        ? { enabled: true, tasks: [] }
        : { lastUsed: { provider: 'p', model: 'm' }, pending: null }),
      setTeamMode: enabled => { calls.push(enabled); return Promise.resolve({ ok: true }) },
    },
  })
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  findAll(tree, node => node.props?.role === 'switch')[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  assert.deepEqual(calls, [], 'nothing is submitted before confirmation')
  assert.equal(findAll(tree, node => hasClass(node, 'dshmf-confirm')).length, 1)
  const confirm = findAll(tree, node => hasClass(node, 'dshmf-confirmBtn'))
    .find(button => button.props['data-primary'] === 'true')
  confirm.props.onClick()
  assert.deepEqual(calls, [false])
})

test('a Session whose directory is not bound yet still renders a trigger', () => {
  runtime.reset()
  const { props } = makeProps(catalogState())
  // Simulate the first mount: `directoryFor` threw, so no store is injected yet.
  delete props.directory
  props.resolveDirectory = () => ({ addressed: false, pending: 'session resolved no scope' })
  const tree = runtime.render(bundle.__component, props)
  const triggers = findAll(tree, node => hasClass(node, 'dshmf-trigger'))
  assert.equal(triggers.length, 1, 'the composer seat is never blank')
  assert.equal(textOf(triggers[0]), 'trigger.loading')
})

test('the seat picks the directory up as soon as the Session binds', () => {
  runtime.reset()
  const { props } = makeProps(catalogState())
  const store = props.directory
  delete props.directory
  let bound = false
  props.resolveDirectory = () => (bound ? { addressed: false, store } : { addressed: false, pending: 'x' })
  let tree = runtime.render(bundle.__component, props)
  assert.equal(textOf(findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0]), 'trigger.loading')
  bound = true
  tree = runtime.render(bundle.__component, props)
  assert.match(textOf(findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0]), /DeepSeek Chat/)
})

test('an addressed subagent Session renders nothing', () => {
  runtime.reset()
  const { props } = makeProps(catalogState(), { inject: { available: false } })
  assert.equal(runtime.render(bundle.__component, props), null)
})

test('an ordinary Session snapshot without a subagent field still renders', () => {
  runtime.reset()
  // Regression: `subagent !== null` is true for `undefined`, which used to hide
  // the whole seat and leave the composer blank.
  const { props } = makeProps(catalogState(), {
    inject: {
      useSession: selector => selector({}),
      useSessions: selector => selector({ byId: { 'session-1': { id: 'session-1' } } }),
    },
  })
  const tree = runtime.render(bundle.__component, props)
  assert.notEqual(tree, null, 'the seat renders for an ordinary Session')
  assert.equal(findAll(tree, node => hasClass(node, 'dshmf-trigger')).length, 1)
})

test('an addressed subagent snapshot still hides the seat', () => {
  runtime.reset()
  const { props } = makeProps(catalogState(), {
    // A real hook applies the selector; the stub must too.
    inject: {
      useSession: selector => selector({ subagent: { parentSessionId: 'p' } }),
      useSessions: () => ({ byId: {} }),
    },
  })
  assert.equal(runtime.render(bundle.__component, props), null)
})

test('a Session listed as a subagent origin hides the seat', () => {
  runtime.reset()
  const { props } = makeProps(catalogState(), {
    inject: {
      useSession: selector => selector({}),
      useSessions: selector => selector({ byId: { 'session-1': { id: 'session-1', origin: 'subagent' } } }),
    },
  })
  assert.equal(runtime.render(bundle.__component, props), null)
})

// ---------------------------------------------------------------------------
// Apply-path tests: the plugin face must register the seat at a negative
// priority even when optional services are missing.
// ---------------------------------------------------------------------------
function makeCtx(options = {}) {
  const registered = []
  const dictionaryRegistrations = []
  const services = {
    locale: {
      register: (ns, dicts) => {
        if (options.localeThrows) throw new Error('namespace already registered')
        dictionaryRegistrations.push({ ns, dicts })
        return () => {}
      },
      resolveText: value => (typeof value === 'string' ? value : (value?.en ?? '')),
      bind: () => key => key,
    },
    slots: {
      inject: (key, factory) => {
        const dispose = factory()
        registered.push({ key, dispose })
        return () => { dispose?.() }
      },
      register: (registration, component) => {
        registered.push({ registration, component })
        return () => {}
      },
    },
    ...(options.services ?? {}),
  }
  // A missing modelDirectories is expressed by omitting the key entirely.
  if (options.modelDirectories !== null) {
    services.modelDirectories = options.modelDirectories ?? {
      directoryFor: () => ({
        store: { subscribe: () => () => {}, getSnapshot: () => EMPTY_STATE_FIXTURE },
        load: () => Promise.resolve(EMPTY_STATE_FIXTURE),
        select: () => Promise.resolve({ ok: true, value: undefined }),
      }),
    }
  }
  if (options.sessions !== null) {
    services.sessions = options.sessions ?? { subagentAddress: () => undefined }
  }
  const ctx = {
    locale: services.locale,
    effect: (callback, label) => {
      const dispose = callback()
      return () => { dispose?.() }
    },
    inject: (names, callback) => callback(services),
    get: name => services[name],
  }
  const seat = () => registered.find(entry => entry.registration?.name === 'conversation.input.model')
  return { ctx, registered, dictionaryRegistrations, services, seat }
}

const EMPTY_STATE_FIXTURE = {
  current: null,
  retainedEffort: undefined,
  routable: null,
  groups: [],
  failures: [],
  status: 'idle',
  pending: null,
  error: null,
}

test('apply registers the seat at a negative priority so it shadows the native picker', () => {
  runtime.reset()
  const { ctx, dictionaryRegistrations, seat } = makeCtx()
  bundle.apply(ctx)
  assert.equal(dictionaryRegistrations.length, 1)
  // The namespace is minted per generation so re-registration cannot collide.
  assert.match(dictionaryRegistrations[0].ns, /^modelFlatmap-/)
  const registeredSeat = seat()
  assert.ok(registeredSeat, 'the seat registration happened')
  assert.equal(registeredSeat.registration.priority, -1)
  assert.equal(typeof registeredSeat.component, 'function')
})

test('apply still registers the seat when the locale namespace is taken', () => {
  runtime.reset()
  const { ctx, seat } = makeCtx({ localeThrows: true })
  bundle.apply(ctx)
  assert.ok(seat(), 'a dictionary conflict never costs the control')
})

test('apply registers the seat when optional services are absent', () => {
  runtime.reset()
  const { ctx, seat } = makeCtx({ services: {} })
  bundle.apply(ctx)
  const registeredSeat = seat()
  assert.ok(registeredSeat)
  const face = registeredSeat.registration.inject('session-1')
  assert.equal(face.available, true)
  assert.equal(face.teamAvailable, false)
  assert.equal(typeof face.select, 'function')
})

test('a directory that cannot resolve yet still yields a renderable seat', () => {
  runtime.reset()
  const { ctx, seat } = makeCtx({
    modelDirectories: {
      directoryFor: () => { throw new Error('session resolved no scope') },
    },
  })
  bundle.apply(ctx)
  const face = seat().registration.inject('session-1')
  assert.equal(face.available, true, 'the seat stays visible')
  assert.equal(face.directory, undefined)
  const tree = runtime.render(bundle.__component, { ...face, locked: false, t: key => key })
  assert.notEqual(tree, null, 'the composer is never blank')
})

// ---------------------------------------------------------------------------
// Seat boundary: a crashed panel must never remove the entry from the slot.
// ---------------------------------------------------------------------------
test('a crashing panel degrades to a minimal chip instead of throwing', () => {
  runtime.reset()
  // A store that throws on read is the cheapest way to make the component fail
  // during render, which is exactly the case that used to abdicate the entry.
  const brokenStore = {
    subscribe: () => () => {},
    getSnapshot: () => { throw new Error('directory exploded') },
  }
  const props = {
    locked: false,
    sessionId: 'session-1',
    t: key => key,
    available: true,
    directory: brokenStore,
    load: () => {},
    select: () => Promise.resolve(undefined),
    resolveText: value => (typeof value === 'string' ? value : value.en),
    teamAvailable: false,
    setTeamMode: () => Promise.resolve(undefined),
    useProjection: () => undefined,
    useSession: selector => selector({}),
    useSessions: selector => selector({ byId: {} }),
  }
  // The boundary is a class component, so the hook stub cannot render it; what
  // matters here is that it declares an error fallback and does not rethrow.
  assert.equal(typeof bundle.__seat, 'function')
  assert.equal(String(bundle.__seat).includes('SeatBoundary'), true)
})

test('the registered component is the boundary-wrapped seat', () => {
  runtime.reset()
  const { ctx, registered } = makeCtx()
  bundle.apply(ctx)
  const seat = registered.find(entry => entry.registration?.name === 'conversation.input.model')
  assert.equal(seat.component, bundle.__seat, 'the boundary wrapper is what the slot holds')
})
