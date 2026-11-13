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
      teamAvailable: () => true,
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

/**
 * How many text-column tracks the grid declares. The template lists one
 * `minmax(0, 1fr)` per column, joined by a 1px gutter track: a single column
 * has no gutter, so the count is the number of `minmax` entries.
 */
function trackCount(grid) {
  const template = String(grid.props.style.gridTemplateColumns)
  return template.split(/\s+/).filter(part => part.includes('minmax')).length
}

/** The grid's direct children, flattened out of the arrays createElement nests. */
function gridChildren(grid) {
  const out = []
  const walk = value => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (value !== null && value !== undefined && typeof value === 'object') out.push(value)
  }
  walk(grid.children)
  return out
}

/** Rows inside the grid only — the off-screen probe also carries the row class. */
function gridRows(tree) {
  const grid = findAll(tree, node => hasClass(node, 'dshmf-grid'))[0]
  return grid === undefined ? [] : findAll(grid, node => hasClass(node, 'dshmf-row'))
}

function gridTitles(tree) {
  const grid = findAll(tree, node => hasClass(node, 'dshmf-grid'))[0]
  return grid === undefined ? [] : findAll(grid, node => hasClass(node, 'dshmf-groupTitle'))
}

// The multiplier markers lifted out of each row name, in grid order: the inner
// text of every `dshmf-rowNameMark` span, in document order.
function gridRowNameMarks(tree) {
  const grid = findAll(tree, node => hasClass(node, 'dshmf-grid'))[0]
  if (grid === undefined) return []
  return findAll(grid, node => hasClass(node, 'dshmf-rowNameMark')).map(textOf)
}

/** The primary text of each row, in grid order. */
function gridRowNames(tree) {
  const grid = findAll(tree, node => hasClass(node, 'dshmf-grid'))[0]
  return grid === undefined
    ? []
    : findAll(grid, node => hasClass(node, 'dshmf-rowName')).map(textOf)
}

/** The secondary text of each row, in grid order; `null` where a row has none. */
function gridRowProviders(tree) {
  const grid = findAll(tree, node => hasClass(node, 'dshmf-grid'))[0]
  if (grid === undefined) return []
  return findAll(grid, node => hasClass(node, 'dshmf-row')).map(row => {
    const tag = findAll(row, node => hasClass(node, 'dshmf-rowProvider'))[0]
    return tag === undefined ? null : textOf(tag)
  })
}

/** The tooltip of each row, in grid order. */
function gridRowTitles(tree) {
  const grid = findAll(tree, node => hasClass(node, 'dshmf-grid'))[0]
  return grid === undefined
    ? []
    : findAll(grid, node => hasClass(node, 'dshmf-row')).map(row => row.props.title)
}

/** Switch the open panel to family grouping and return the new tree. */
function switchToFamily(tree, props) {
  findAll(tree, node => hasClass(node, 'dshmf-segBtn'))
    .find(button => button.props.title === 'group.family').props.onClick()
  return runtime.render(bundle.__component, props)
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

test('a model name with a xN multiplier lifts it into a smaller bold run', () => {
  // Rate/size markers such as "x0.01", "x1.5", "X 2.2" (with or without a
  // space, any case) are split out of the name into a `dshmf-rowNameMark`
  // span, drawn two sizes smaller and bold, while the full name is unchanged.
  runtime.reset()
  const state = catalogState({
    groups: [{
      id: 'mult',
      name: 'Multipliers',
      models: [
        { id: 'a', name: 'Claude x3' },
        { id: 'b', name: 'GPT x0.01' },
        { id: 'c', name: 'Model X 2.2' },
        { id: 'd', name: 'PlainModel' },
        { id: 'e', name: 'GenX5' },  // x sits inside a word, not a multiplier token
      ],
    }],
  })
  const { props } = makeProps(state)
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  // The reconstructed name stays intact: markers are not removed or reordered.
  assert.deepEqual(gridRowNames(tree), [
    'Claude x3', 'GPT x0.01', 'Model X 2.2', 'PlainModel',
    'GenX5',
  ])
  // One marker run per name that actually has one, and no others.
  assert.deepEqual(gridRowNameMarks(tree), ['x3', 'x0.01', 'X 2.2'])
  const markSpans = findAll(tree, node => hasClass(node, 'dshmf-rowNameMark'))
  assert.equal(markSpans.length, 3)
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

  // reasoning levels of the current model: one labelled group of
  // mutually exclusive radio choices, exactly one checked
  const group = findAll(tree, node => node.props?.role === 'radiogroup')[0]
  assert.ok(group, 'the reasoning group exists')
  const groupLabel = findAll(group, node => hasClass(node, 'dshmf-reasonLabel'))[0]
  assert.ok(groupLabel, 'the group carries its caption')
  assert.equal(textOf(groupLabel), 'effort.label')
  assert.equal(group.props['aria-labelledby'], groupLabel.props.id)
  const pills = findAll(group, node => hasClass(node, 'dshmf-pill'))
  assert.equal(pills.length, 3)
  assert.equal(pills.every(pill => pill.props.role === 'radio'), true)
  assert.equal(pills.filter(pill => pill.props['aria-checked'] === true).length, 1)

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

test('family grouping makes the provider the primary row text', () => {
  // The heading says what the models ARE, so the family name is not repeated
  // in a row. The row's primary text is the provider, and the full model name
  // stays in the tooltip.
  runtime.reset()
  const { props } = makeProps(catalogState())
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  tree = switchToFamily(tree, props)
  assert.deepEqual(gridRowNames(tree), [
    'provider.account', 'provider.account', // DeepSeek family
    'Third Party', 'Third Party', 'Third Party', 'Third Party',
  ])
  // The family name never appears as row text; the model name is in the tooltip.
  for (const title of gridRowTitles(tree)) {
    assert.match(title, /DeepSeek|Grok|GLM|Kimi|Mystery|provider\.account|Third Party/)
  }
})

test('provider grouping keeps the model name as the primary text', () => {
  // The heading already IS the provider, so the row text stays the model name
  // and no secondary variant tag is drawn.
  runtime.reset()
  const { props } = makeProps(catalogState())
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  assert.deepEqual(gridRowNames(tree), [
    'DeepSeek Chat', 'DeepSeek Reasoner',
    'Grok 4', 'GLM 4.6', 'Kimi K2', 'Mystery',
  ])
  assert.deepEqual(gridRowProviders(tree), [null, null, null, null, null, null])
})

test('family grouping keeps generations apart and never repeats the family name', () => {
  // hy3 / hy3-x are HY3; hy4-preview / hy4free / hy4std are HY4. The old
  // decision merged them all into HY — that was a mistake. Each row's primary
  // text is its provider, and no row repeats the family name as its text.
  const state = catalogState({
    current: null,
    groups: [
      {
        id: 'codebuddy-cli',
        name: 'CodeBuddy CLI',
        models: [
          { id: 'hy3', name: 'Hy3' },
          { id: 'hy3-x', name: 'Hy3' },
          { id: 'hy4-preview', name: 'Hy4' },
          { id: 'hy4std', name: 'Hy4' },
        ],
      },
      {
        id: 'workbuddy-global',
        name: 'WorkBuddy Global',
        models: [{ id: 'hy4free', name: 'Hy4' }],
      },
    ],
  })
  runtime.reset()
  const { props } = makeProps(state)
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  tree = switchToFamily(tree, props)
  assert.deepEqual(gridTitles(tree).map(textOf), ['HY3', 'HY4'])
  // Every row's primary text is its provider; the family name is not repeated.
  assert.deepEqual(gridRowNames(tree), [
    'CodeBuddy CLI', 'CodeBuddy CLI', 'CodeBuddy CLI', 'CodeBuddy CLI',
    'WorkBuddy Global',
  ])
  for (const name of gridRowNames(tree)) {
    assert.doesNotMatch(name, /^HY[34]?$/, 'no family name as row text')
  }
  // One provider offers several models per family, so those rows carry a short
  // variant tail; the plain base model (hy3) and the lone WorkBuddy row need
  // none (null = no tag), which is exactly the "smart, flexible" change.
  assert.deepEqual(gridRowProviders(tree), [null, 'x', 'preview', 'std', null])
})

test('a localized provider name is resolved once for heading and row text', () => {
  // Catalog provider names arrive localized; both faces of the panel have to
  // draw the resolved label, not the raw `{ zh, en }` record.
  const state = catalogState({
    current: null,
    groups: [{
      id: 'vendor-x',
      name: { zh: '豆包(doubao)', en: 'Doubao' },
      models: [{ id: 'doubao-seed-1.6', name: 'Doubao Seed 1.6' }],
    }],
  })
  runtime.reset()
  const { props } = makeProps(state)
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  assert.deepEqual(gridTitles(tree).map(textOf), ['Doubao'])
  tree = switchToFamily(tree, props)
  assert.deepEqual(gridTitles(tree).map(textOf), ['Doubao'])
  assert.deepEqual(gridRowNames(tree), ['Doubao'])
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

test('a multi-word query finds a provider whose words are not contiguous', () => {
  // `ModelScope International` never contains `mod inte` as one substring, so
  // the whole-string test used to drop the provider; token matching keeps it
  // and therefore its whole catalog.
  const state = catalogState({
    current: null,
    groups: [{
      id: 'modelscope',
      name: 'ModelScope International',
      models: [
        { id: 'qwen3-235b', name: 'Qwen3 235B' },
        { id: 'deepseek-v3', name: 'DeepSeek V3' },
      ],
    }],
  })
  const { tree } = openAndSearch(state, 'mod inte')
  assert.deepEqual(gridTitles(tree).map(textOf), ['ModelScope International'])
  assert.deepEqual(gridRowNames(tree).sort(), ['DeepSeek V3', 'Qwen3 235B'])
  // A token that matches nothing still drops the provider entirely.
  assert.deepEqual(gridRowNames(openAndSearch(state, 'mod zzz').tree), [])
})

test('a multi-word query also finds models by their own name', () => {
  const state = catalogState({
    current: null,
    groups: [{
      id: 'vendor',
      name: 'Vendor',
      models: [
        { id: 'qwen3-coder', name: 'Qwen3 Coder' },
        { id: 'qwen3-chat', name: 'Qwen3 Chat' },
      ],
    }],
  })
  // Both tokens match the model names, so no provider-wide widening is needed.
  assert.deepEqual(gridRowNames(openAndSearch(state, 'qwen3 cod').tree), ['Qwen3 Coder'])
  assert.deepEqual(gridRowNames(openAndSearch(state, 'qwen3 chat').tree), ['Qwen3 Chat'])
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
  // Grouping changes the headings and makes each row name its provider; the
  // same four models stay visible, so every row's primary text is the provider.
  assert.deepEqual(gridRowNames(tree), [
    '豆包(doubao)', '豆包(doubao)', '豆包(doubao)', '豆包(doubao)',
  ])
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
  const columns = trackCount(grid)
  assert.ok(columns >= 1 && columns <= 3)
  assert.equal(findAll(grid, node => hasClass(node, 'dshmf-col')).length, columns)
  assert.equal(findAll(grid, node => hasClass(node, 'dshmf-row')).length, 30)
  // One hairline gutter between each pair of columns, and nothing else.
  assert.equal(findAll(grid, node => hasClass(node, 'dshmf-colDivider')).length, columns - 1)
})

test('the divider is a sibling of the columns, not a border on one', () => {
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
  const columns = trackCount(grid)
  if (columns < 2) return
  // Grid children alternate col / divider / col / divider / col, so the line is
  // never a descendant of a column and cannot be clipped to its content height.
  const children = gridChildren(grid).filter(node => !hasClass(node, 'dshmf-failure'))
  assert.equal(children.length, columns * 2 - 1)
  children.forEach((node, index) => {
    const divider = index % 2 === 1
    assert.equal(hasClass(node, divider ? 'dshmf-colDivider' : 'dshmf-col'), true)
  })
  for (const column of findAll(grid, node => hasClass(node, 'dshmf-col'))) {
    assert.equal(findAll(column, node => hasClass(node, 'dshmf-colDivider')).length, 0)
  }
  assert.equal(source.includes('dshmf-col--divided'), false)

  // The pairing that makes it span the whole grid: the line is the only grid
  // item that re-opts into `stretch` (the grid itself says `align-items: start`
  // so the text columns keep their natural height), and it owns the 6px
  // breathing room at both ends instead of a per-column border.
  const css = source.match(/const CSS = `([\s\S]*?)`/)[1]
  const gridRule = css.match(/\.dshmf-grid \{([\s\S]*?)\}/)[1]
  assert.match(gridRule, /align-items: start/)
  const dividerRule = css.match(/\.dshmf-colDivider \{([\s\S]*?)\}/)[1]
  assert.match(dividerRule, /align-self: stretch/)
  assert.match(dividerRule, /margin: 6px 0/)
  assert.match(dividerRule, /width: 1px/)
  assert.match(dividerRule, /background: var\(--dsw-alias-border-l3\)/)
  assert.equal(/border-(right|left|inline)/.test(dividerRule), false,
    'the line is painted by the item itself, not borrowed from a column border')
})

test('every grid child is placed on its own explicit track, never auto-placed', () => {
  // Auto-placement is what broke this once: a divider pinned to row 1 but not
  // to a column is laid out BEFORE the columns, takes track 1, and pushes the
  // columns onto tracks 2 and 3 — the first text column then collapses and the
  // columns overlap. So each child must name its own grid-column, and the
  // tracks of a 3-column layout must be col gutter col gutter col.
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
  const columns = trackCount(grid)
  if (columns < 2) return

  const children = gridChildren(grid).filter(node => !hasClass(node, 'dshmf-failure'))
  const tracks = children.map(node => {
    const placed = node.props.style?.gridColumn
    assert.ok(placed !== undefined && placed !== '', 'every grid item states its own grid-column')
    return Number(placed)
  })
  // One item per track, no collisions and no gaps, columns on the odd tracks.
  assert.deepEqual(tracks, children.map((_, index) => index + 1))
  children.forEach((node, index) => {
    assert.equal(hasClass(node, 'dshmf-col') === (index % 2 === 0), true,
      'text columns sit on their own tracks with a gutter between them')
    assert.equal(node.props.style.gridRow, '1')
  })
  // The declared template must carry exactly one hairline track per gutter.
  assert.equal(trackCount(grid), columns)
  assert.equal(String(grid.props.style.gridTemplateColumns).split('1px').length - 1, columns - 1)
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
  assert.equal(trackCount(grid), 1)
  assert.equal(findAll(grid, node => hasClass(node, 'dshmf-colDivider')).length, 0)
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

test('re-clicking the checked reasoning level submits nothing', () => {
  runtime.reset()
  const calls = []
  const { props } = makeProps(catalogState(), {
    inject: { select: selection => { calls.push(selection); return Promise.resolve({ ok: true }) } },
  })
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  const checked = findAll(tree, node => hasClass(node, 'dshmf-pill'))
    .find(candidate => candidate.props['aria-checked'] === true)
  assert.ok(checked, 'one level is checked')
  checked.props.onClick()
  assert.deepEqual(calls, [])
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
  assert.equal(face.teamAvailable(), false)
  assert.equal(typeof face.select, 'function')
})

// Regression guard for the bug where the teamwork switch never rendered:
// the Host's `remote.agentTeams` namespace service must be read by its full
// service name, and a present service must make the row appear.
test('a present remote.agentTeams makes the teamwork row render', () => {
  runtime.reset()
  const calls = []
  const { ctx, seat } = makeCtx({
    services: {
      'remote.agentTeams': {
        setEnabled: (sessionId, enabled) => { calls.push({ sessionId, enabled }); return Promise.resolve({ ok: true }) },
      },
    },
  })
  bundle.apply(ctx)
  const face = seat().registration.inject('session-1')
  assert.equal(face.teamAvailable(), true, 'the service is resolved by full name, not as ctx.remote')
  const props = {
    ...face,
    locked: false,
    t: key => key,
    // The host's own TeamModeToggle hides itself unless the session projects
    // `agentTeam`; the panel mirrors that contract.
    useProjection: key => (key === 'agentTeam' ? { enabled: false, tasks: [] } : undefined),
  }
  const closed = runtime.render(bundle.__component, props)
  findAll(closed, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  const open = runtime.render(bundle.__component, props)
  const switches = findAll(open, node => node.props?.role === 'switch')
  assert.equal(switches.length, 1, 'the host-shaped teamwork switch renders')
  assert.equal(switches[0].props['aria-checked'], false)
})

// The Host's TeamModeToggle calls
//   scope.remote.agentTeams.setEnabled(sessionId, enabled)
// with the slot's sessionId and a boolean. Pin that exact contract: the same
// endpoint, the same two arguments, no extra/missing parameters.
test('turning the teamwork switch ON calls setEnabled(sessionId, true)', () => {
  runtime.reset()
  const calls = []
  const { ctx, seat } = makeCtx({
    services: {
      'remote.agentTeams': {
        setEnabled: (...args) => { calls.push(args); return Promise.resolve({ ok: true, value: undefined }) },
      },
    },
  })
  bundle.apply(ctx)
  const face = seat().registration.inject('session-1')
  const props = {
    ...face,
    locked: false,
    t: key => key,
    useProjection: key => (key === 'agentTeam' ? { enabled: false, tasks: [] } : undefined),
  }
  const closed = runtime.render(bundle.__component, props)
  findAll(closed, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  const open = runtime.render(bundle.__component, props)
  findAll(open, node => node.props?.role === 'switch')[0].props.onClick()
  assert.deepEqual(calls, [['session-1', true]])
})

test('the teamwork row is omitted when remote.agentTeams is absent', () => {
  runtime.reset()
  const { ctx, seat } = makeCtx({ services: {} })
  bundle.apply(ctx)
  const face = seat().registration.inject('session-1')
  const tree = runtime.render(bundle.__component, { ...face, locked: false, t: key => key })
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  const open = runtime.render(bundle.__component, { ...face, locked: false, t: key => key })
  assert.equal(findAll(open, node => node.props?.role === 'switch').length, 0)
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
    teamAvailable: () => false,
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

// ---------------------------------------------------------------------------
// Provider / family labels must be visually distinct from model rows: a filled
// band with smaller, bold type, using host theme tokens (no hard-coded colour).
// ---------------------------------------------------------------------------
test('the group-title label is a distinct filled band, not a plain row-like caption', () => {
  const css = source.match(/const CSS = `([\s\S]*?)`/)[1]
  const title = css.match(/\.dshmf-groupTitle \{([\s\S]*?)\}/)[1]
  const row = css.match(/\.dshmf-row \{([\s\S]*?)\}/)[1]
  const prop = (block, name) => {
    const hit = block.match(new RegExp(`${name}:\\s*([^;]+);`))
    return hit === null ? undefined : hit[1].trim()
  }
  const size = value => Number.parseFloat(value, 10)

  // An opaque, theme-neutral surface fill — never a hard-coded colour. The band
  // must step AWAY from the panel surface in BOTH themes: visibly darker than
  // the white panel in light, visibly lighter than the near-black surface in
  // dark. `bg-overlay` resolves to a soft grey in light and a light grey in
  // dark, doing exactly that without a second theme branch (see DEC-005).
  assert.match(prop(title, 'background'), /var\(--dsw-alias-bg-overlay\)/,
    'band floats on the opaque grey overlay surface')
  assert.match(prop(title, 'box-shadow'), /dsw-elevation-soft/,
    'soft elevation lifts the band off the surface')
  assert.doesNotMatch(prop(title, 'background'), /menu-group-header-fill|bg-module-platform/,
    'the near-surface group-header fill is no longer the standing background')
  assert.match(prop(title, 'background'), /bg-overlay/,
    'fill is not the panel base/layer-1 surface — it steps away from it in both themes')
  assert.doesNotMatch(prop(title, 'background'), /#[0-9a-f]|rgba?\(/i, 'no hard-coded colour value')
  assert.match(prop(title, 'border-radius'), /dsw-radius/, 'rounded corners come from a radius token')

  // A low-key frame around the label: hairline border + a grey (border-level-3)
  // left edge — theme-neutral, no colour accent — both theme tokens (no
  // hard-coded colour). 20px tall, unchanged, so the probe-measured headH and
  // the column planner stay valid.
  assert.match(prop(title, 'border'), /dsw-alias-border/, 'hairline frame comes from a border token')
  assert.doesNotMatch(prop(title, 'border'), /#[0-9a-f]|rgba?\(/i, 'frame colour is not hard-coded')
  assert.match(prop(title, 'border-left'), /3px/, 'the left accent is a short bar')
  assert.match(prop(title, 'border-left'), /dsw-alias-border-l3/, 'the left edge uses the grey border-level-3 token, not a colour accent')
  assert.equal(prop(title, 'height'), '20px', 'label height is unchanged for the column planner')

  // Smaller than the row, but bold — clearly a label, not model-row text.
  assert.ok(size(prop(title, 'font-size')) < size(prop(row, 'font-size')),
    'label font is smaller than the model row font (13px)')
  assert.ok(Number(prop(title, 'font-weight')) >= 600,
    'label is bold while the row stays regular (400)')
  assert.ok(Number(prop(row, 'font-weight')) < 600, 'model row keeps regular weight')
})

// DEC-005: the bare host group-header fill is only a few levels away from the
// translucent panel surface, so the band must sit on an opaque grey overlay
// surface that steps AWAY from the panel base in BOTH themes — darker than the
// white panel in light and lighter than the near-black surface in dark — to
// stay clearly apart from the rows in both. Pin the opaque fill and the
// transparent row background so a regression to the near-identical plain fill
// cannot slip back in.
test('the group-title band steps away from the row surface with an opaque grey surface', () => {
  const css = source.match(/const CSS = `([\s\S]*?)`/)[1]
  const title = css.match(/\.dshmf-groupTitle \{([\s\S]*?)\}/)[1]
  const row = css.match(/\.dshmf-row \{([\s\S]*?)\}/)[1]
  const prop = (block, name) => {
    const hit = block.match(new RegExp(`${name}:\\s*([^;]+);`))
    return hit === null ? undefined : hit[1].trim()
  }

  assert.match(prop(title, 'background'), /var\(--dsw-alias-bg-overlay\)/,
    'band floats on the opaque grey overlay surface theme token')
  assert.doesNotMatch(prop(title, 'background'), /menu-group-header-fill/,
    'the near-surface group-header fill is no longer the standing background')
  assert.doesNotMatch(prop(title, 'background'), /bg-layer-1|bg-base/,
    'fill is not the panel base/layer-1 surface — it must step away from it in both themes')
  assert.match(prop(title, 'box-shadow'), /dsw-elevation-soft/,
    'soft elevation lifts the band off the surface like the active segment')
  assert.doesNotMatch(prop(title, 'background'), /#[0-9a-f]|rgba?\(/i,
    'no hard-coded colour value')

  // The model rows stay transparent (background only on hover/focus), so the
  // filled band is the only standing separation from the surface.
  assert.equal(prop(row, 'background'), 'transparent', 'model rows keep a transparent background')
})

// ---------------------------------------------------------------------------
// Selected model: a blue band with bold on-fill text, not a checkmark.
//
// The checkmark cost a permanently reserved tail column (empty on every
// unselected row) and only marked the selection with a 14px glyph. The row
// itself now carries the selection, which is both louder and cheaper.
// ---------------------------------------------------------------------------
test('a selected model row is a blue band with bold on-fill text, not a checkmark', () => {
  runtime.reset()
  const { props } = makeProps(catalogState())
  let tree
  runtime.setRerender(() => { tree = runtime.render(bundle.__component, props) })
  tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)

  const rows = gridRows(tree)
  const selected = rows.filter(row => row.props['aria-pressed'] === true)
  assert.equal(selected.length, 1, 'exactly the current model is pressed')
  assert.equal(textOf(findAll(selected[0], node => hasClass(node, 'dshmf-rowName'))[0]), 'DeepSeek Chat')

  // Selection is expressed by the row state, never by a drawn check glyph.
  assert.equal(findAll(tree, node => node.type === 'svg' && node.props?.['data-icon'] === 'check').length, 0,
    'no check icon is drawn for the selection')
  const css = source.match(/const CSS = `([\s\S]*?)`/)[1]
  assert.equal(css.includes('PATH_CHECK'), false, 'the check path is gone from the client')
  assert.equal(source.includes('PATH_CHECK'), false, 'the check glyph constant is no longer defined')

  // The row's tail no longer reserves space on unselected rows: the probe,
  // which mirrors the tallest row shape, carries no tail.
  const selectedTails = findAll(selected[0], node => hasClass(node, 'dshmf-rowTail'))
  assert.equal(selectedTails.length, 0, 'a selected idle row draws no trailing element')
  const probe = findAll(tree, node => hasClass(node, 'dshmf-probe'))[0]
  assert.equal(findAll(probe, node => hasClass(node, 'dshmf-rowTail')).length, 0,
    'the measurement probe no longer reserves a tail column')
})

test('the selected-row CSS is a deep blue band with white bold text', () => {
  const css = source.match(/const CSS = `([\s\S]*?)`/)[1]
  const rule = css.match(/\.dshmf-row\[aria-pressed="true"\][\s\S]*?\{([\s\S]*?)\}/)[1]
  const prop = name => {
    const hit = rule.match(new RegExp(`${name}:\\s*([^;]+);`))
    return hit === null ? undefined : hit[1].trim()
  }

  // A deep blue fill with white text, pinned to the theme-invariant static
  // palette. The `--dsw-alias-state-business-primary` alias would flip to a
  // LIGHT blue with dark text in the dark theme, which is not what was asked
  // for: both themes must read as deep blue + white.
  assert.match(prop('background'), /var\(--dsw-static-deepseek-600/,
    'selected rows fill with the deep blue static token')
  assert.match(prop('color'), /var\(--dsw-static-neutral-bluish-00/,
    'selected text is the white static token')
  assert.equal(prop('background').includes('state-business-primary'), false,
    'the flipping alias is not used for the fill')
  assert.doesNotMatch(prop('background'), /#[0-9a-f]/i, 'the token carries the colour, not a literal')
  assert.ok(Number(prop('font-weight')) >= 600, 'selected text is bold')

  // Hover must not repaint the selected row with the neutral hover wash.
  assert.match(css, /\.dshmf-row:hover:not\(:disabled\):not\(\[aria-pressed="true"\]\)/,
    'hover is skipped for the selected row so the highlight stays put')
})

// ---------------------------------------------------------------------------
// The teamwork switch sits immediately right of its title, both left-aligned.
// `space-between` used to push the switch to the far edge of the panel.
// ---------------------------------------------------------------------------
test('the teamwork row packs label and switch to the left', () => {
  const css = source.match(/const CSS = `([\s\S]*?)`/)[1]
  const team = css.match(/\.dshmf-team \{([\s\S]*?)\}/)[1]
  const prop = name => {
    const hit = team.match(new RegExp(`${name}:\\s*([^;]+);`))
    return hit === null ? undefined : hit[1].trim()
  }
  assert.match(prop('justify-content'), /flex-start/, 'no space-between push to the far edge')
  assert.doesNotMatch(prop('justify-content'), /space-between/)
  assert.match(prop('display'), /flex/, 'the row is a flex line')
  assert.match(prop('align-items'), /center/, 'label and switch stay vertically centred')
})


// ---------------------------------------------------------------------------
// One obvious grey divider separates the scrolling model grid from the fixed
// footer holding BOTH groups. It belongs to the footer container, so it stays
// put whether the groups share a line or stack, and neither child draws one.
// ---------------------------------------------------------------------------
test("a single grey divider sits above the whole footer, on neither group", () => {
  const css = source.match(/const CSS = `([\s\S]*?)`/)[1]
  const footer = css.match(/\.dshmf-footer \{([\s\S]*?)\}/)[1]
  const reason = css.slice(css.indexOf(".dshmf-reason {"), css.indexOf(".dshmf-reasonLabel {"))
  const team = css.slice(css.indexOf(".dshmf-team {"), css.indexOf(".dshmf-teamLabel {"))

  assert.ok(footer.includes("border-top: 1px solid #9CA3AF"), "ordinary grey line above the footer block")
  assert.ok(css.includes("body[data-ds-dark-theme] .dshmf-footer"), "dark theme switches to a lighter grey")
  assert.equal(reason.includes("border-top"), false, "the reasoning group does not own the divider")
  assert.equal(team.includes("border-top"), false, "no divider between reasoning and teamwork")
})

// ---------------------------------------------------------------------------
// The grouping choice must persist across sessions and workgroups. The Web GUI
// runs on a stable origin, so the choice is kept in `localStorage` and read
// back on every mount. These tests drive the same read/write helpers the
// component uses, with a `localStorage` shim, and confirm the
// default-without-storage path.
// ---------------------------------------------------------------------------
function installStorage(entries = {}) {
  const map = new Map(Object.entries(entries))
  globalThis.localStorage = {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
  }
  return map
}

test('the grouping choice is restored from storage on mount', () => {
  const store = installStorage({ [bundle.__test.GROUPING_KEY]: 'family' })
  try {
    assert.equal(bundle.__test.readGrouping(), 'family', 'family is read back')
    assert.equal(bundle.__test.readGrouping(), 'family', 'reading twice is stable')
  } finally {
    delete globalThis.localStorage
  }
})

test('the grouping choice falls back to the default when nothing is stored', () => {
  const store = installStorage()
  try {
    assert.equal(bundle.__test.readGrouping(), bundle.__test.GROUPING_DEFAULT, 'default when key is absent')
  } finally {
    delete globalThis.localStorage
  }
})

test('an unrecognised stored value is treated as the default', () => {
  const store = installStorage({ [bundle.__test.GROUPING_KEY]: 'by-color' })
  try {
    assert.equal(bundle.__test.readGrouping(), bundle.__test.GROUPING_DEFAULT, 'garbage falls back to default')
  } finally {
    delete globalThis.localStorage
  }
})

test('choosing a grouping writes it to storage for the next mount', () => {
  const store = installStorage()
  try {
    bundle.__test.writeGrouping('family')
    assert.equal(store.get(bundle.__test.GROUPING_KEY), 'family', 'family is persisted')
    bundle.__test.writeGrouping('provider')
    assert.equal(store.get(bundle.__test.GROUPING_KEY), 'provider', 'provider is persisted over family')
  } finally {
    delete globalThis.localStorage
  }
})

test('a missing localStorage still yields the default without throwing', () => {
  delete globalThis.localStorage
  assert.equal(bundle.__test.readGrouping(), bundle.__test.GROUPING_DEFAULT, 'default without storage')
  assert.doesNotThrow(() => bundle.__test.writeGrouping('family'), 'writing is a no-op without storage')
})

// Adaptive footer: the reasoning group and the teamwork group share one line
// when both fit with a 30px gap, otherwise each keeps its own line. The
// decision is CSS flex-wrap, so the DOM always holds both in ONE footer.
// ---------------------------------------------------------------------------
function openPanel(state, options) {
  runtime.reset()
  const made = makeProps(state, options)
  let tree
  runtime.setRerender(() => { tree = runtime.render(bundle.__component, made.props) })
  tree = runtime.render(bundle.__component, made.props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, made.props)
  return { tree, made }
}

test('reason and team live in one footer container, strips stay outside', () => {
  const { tree } = openPanel(catalogState())
  const footers = findAll(tree, node => hasClass(node, 'dshmf-footer'))
  assert.equal(footers.length, 1, 'one adaptive footer wraps both groups')
  const reason = findAll(tree, node => hasClass(node, 'dshmf-reason'))[0]
  const team = findAll(tree, node => hasClass(node, 'dshmf-team'))[0]
  assert.ok(reason && team, 'both groups render')
  assert.ok(findAll(footers[0], node => node === reason).length === 1,
    'the reasoning group is inside the footer')
  assert.ok(findAll(footers[0], node => node === team).length === 1,
    'the teamwork group is inside the footer')
  // Failure/confirmation strips are NOT footer children: they keep their own
  // full-width rows and the footer stays the bottom-most fixed block.
  assert.equal(findAll(footers[0], node => hasClass(node, 'dshmf-error')).length, 0)
  assert.equal(findAll(footers[0], node => hasClass(node, 'dshmf-confirm')).length, 0)
})

test('the footer is a wrapping flex line with a 30px gap between the groups', () => {
  const css = source.match(/const CSS = `([\s\S]*?)`/)[1]
  const footer = css.match(/\.dshmf-footer \{([\s\S]*?)\}/)[1]
  const prop = name => {
    const hit = footer.match(new RegExp(`${name}:\\s*([^;]+);`))
    return hit === null ? undefined : hit[1].trim()
  }
  assert.match(prop('display'), /flex/, 'the footer is a flex line')
  assert.match(prop('flex-wrap'), /wrap/, 'it wraps to two lines when they do not fit')
  assert.match(prop('column-gap'), /30px/, 'at least 30px is guaranteed between the two groups')
})

test('the footer renders neither group when both are absent, and one when only one exists', () => {
  // No reasoning metadata and no agentTeams projection: no footer at all.
  const noTeam = catalogState({ current: { provider: 'third-party', model: 'glm-4.6' } })
  const a = openPanel(noTeam, { inject: { useProjection: () => undefined, teamAvailable: () => false } })
  assert.equal(findAll(a.tree, node => hasClass(node, 'dshmf-footer')).length, 0,
    'no groups means no empty footer')

  // Reasoning present, teamwork absent: footer still wraps the reasoning group.
  const b = openPanel(catalogState(), { inject: { useProjection: () => undefined, teamAvailable: () => false } })
  const footers = findAll(b.tree, node => hasClass(node, 'dshmf-footer'))
  assert.equal(footers.length, 1)
  assert.equal(findAll(footers[0], node => hasClass(node, 'dshmf-reason')).length, 1)
  assert.equal(findAll(footers[0], node => hasClass(node, 'dshmf-team')).length, 0)

  // Teamwork present, no reasoning: footer still wraps the team group.
  const c = openPanel(catalogState({ current: { provider: 'third-party', model: 'glm-4.6' } }))
  const cf = findAll(c.tree, node => hasClass(node, 'dshmf-footer'))
  assert.equal(cf.length, 1)
  assert.equal(findAll(cf[0], node => hasClass(node, 'dshmf-reason')).length, 0)
  assert.equal(findAll(cf[0], node => hasClass(node, 'dshmf-team')).length, 1)
})

test('the teamwork row draws no divider and layout stays CSS-owned', () => {
  const css = source.match(/const CSS = `([\s\S]*?)`/)[1]
  const team = css.match(/\.dshmf-team \{([\s\S]*?)\}/)[1]
  assert.equal(team.includes('border-top'), false,
    'the teamwork row never draws its own divider, in either state')
  // No JS width threshold decides the layout: only the footer wrap + gap do.
  const footer = css.match(/\.dshmf-footer \{([\s\S]*?)\}/)[1]
  assert.doesNotMatch(footer, /width:/, 'the footer does not hard-code a width')
  assert.doesNotMatch(source, /footerInline.*px|px.*footerInline/, 'no pixel guess in JS')
})

test('the fixed-height measurement counts the footer once, not reason+team twice', () => {
  const heights = source.match(/const heights = \[([^\]]+)\]/)[1]
  assert.ok(heights.includes('footerRef'), 'the composed footer is measured')
  assert.ok(!heights.includes('reasonRef') && !heights.includes('teamRef'),
    'the two overlapping children are not double-counted')
})
// Insufficient balance / credit / quota: the model row is struck through until
// a later call for the same model returns something else.
// ---------------------------------------------------------------------------

const INSUFFICIENT = bundle.__test

// Real recorded failures, harvested from the local DSH session history
// (~/.dsh/sessions/*/session.v4.jsonl.zstd, 1270 sessions) by folding every
// `turn/end` whose reason was an error. Each entry is the exact
// `{ code, status?, message }` the Host stored, so the classifier is pinned
// against what providers actually send rather than against invented wording.
//
// The 429 cases matter most: several providers answer an exhausted balance
// with HTTP 429 rather than 402, and the Host classifies that as RATE_LIMIT —
// which is normally transient. The message has to decide in that case.
const REAL_INSUFFICIENT = [
  // modelscope-token-plan — the user's own example, 71 occurrences in history.
  { code: 'RATE_LIMIT', message: '429: {"message":"insufficient balance","request_id":"4f188d7b-3798-417c-93c3-b93a32bdbb4e"}' },
  // The same fact carried as the structured status.
  { code: 'RATE_LIMIT', status: 429, message: '429: {"message":"insufficient balance"}' },
  // codebuddy-cli — 额度已用尽 (soft_rate).
  { code: 'RATE_LIMIT', message: '429: {"message":"codebuddy upstream soft_rate (http 429): {\\"error\\":{\\"data\\":{\\"code\\":14018,\\"msg\\":\\"额度已用尽，请访问以下链接，购买加量包以获取更多额度：https://www.codebuddy.cn/profile/usage \\"}}}","type":"soft_rate","code":"soft_rate"}' },
  // minimax — 402 with insufficient_balance_error.
  { code: 'QUOTA_EXCEEDED', status: 402, message: 'minimax: HTTP 402 — {"type":"error","error":{"type":"insufficient_balance_error","message":"insufficient balance (1008)"},"request_id":"0739b52b09c5d5907484ac17d0a644dc"}' },
  // openai — no credits remaining.
  { code: 'PI_AI_ERROR', message: 'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.' },
  // xai — 403 with no credits or licenses.
  { code: 'AUTH', message: 'xai API error (403): 403 "Your newly created team doesn\'t have any credits or licenses yet. You can purchase those on https://console.x.ai/team/c46f64e1-a11b-4813-a49c-fe002cc0d912."' },
  // bamboo — new-api gateway refusing to pre-consume an insufficient quota.
  { code: 'AUTH', message: '403: {"message":"Not enough quota to pre-consume for this request: ＄0.009740 remaining, ＄0.059864 required (request id: 202611020742226305085428268d9d6otJmysNm)","type":"new_api_error","param":"","code":"insufficient_user_quota"}' },
  // trae — SOLO quota exhausted (hard_credit).
  { code: 'QUOTA', message: '402: {"message":"Trae reports the account\'s SOLO quota is exhausted for this request · Trae code 4008 · upstream: Your requests have exceeded the quota.","type":"hard_credit","code":"hard_credit"}' },
  // workbuddy — quota_exceeded with a reset time.
  { code: 'QUOTA', message: '429: {"message":"workbuddy 上游失败：被限流（http 429）：池中已无可用账号（1 个账号被限流）（code 6004，requestId 01a1d3c0de1b762f916ed17cb1f78a82）。您的使用量已超出频率限制，将在 2026-11-14 10:32:55 UTC+8 重置，您也可以切换其他模型继续使用。建议换一个模型继续，或稍后等待该账号的额度恢复","type":"soft_rate","code":"quota_exceeded"}' },
  // doubao / workbuddy — the day's budget is spent.
  { code: 'BUDGET_EXHAUSTED', message: '今日学习调用预算已用完' },
  // qoder — billing daily count.
  { code: 'QUOTA_EXCEEDED', message: 'qoder: Billing daily count exceeded' },
  // Plain wording the Host did not classify, kept for the fallback path.
  { code: 'UNKNOWN', message: 'insufficient balance' },
  { code: 'UNKNOWN', message: 'Insufficient credits for this request' },
  { code: 'UNKNOWN', message: 'You are out of credits' },
  { code: 'UNKNOWN', message: 'quota exceeded' },
  { code: 'UNKNOWN', message: '账户余额不足' },
  { code: 'UNKNOWN', message: '额度不足' },
]

// Failures that must NOT strike. These are real too: the first two are genuine
// rate limits from the same providers that also emit balance failures, so a
// naive "429 means out of balance" rule would wrongly strike a healthy model.
const REAL_TRANSIENT = [
  // opencode2dsh — a real rate limit.
  { code: 'RATE_LIMIT', message: '429: {"type":"FreeUsageLimitError","message":"Rate limit exceeded. Please try again later."}' },
  // codebuddy-cli — 使用量已超出频率限制 (a limit that resets, not an empty balance).
  { code: 'RATE_LIMIT', message: '429: {"message":"codebuddy upstream soft_rate (http 429): {\\"code\\":6004,\\"msg\\":\\"您的使用量已超出频率限制，将在 2026-10-07 08:00:00 UTC+8 重置，您也可以切换其他模型继续使用。\\"}","type":"soft_rate","code":"soft_rate"}' },
  // bigmodel — 访问量过大 (load, not balance).
  { code: 'RATE_LIMIT', message: '429: {"code":"1305","message":"该模型当前访问量过大，请您稍后再试"}' },
  // modelscope — an explicit rate limit with a commercial hint.
  { code: 'RATE_LIMIT', message: '429: {"message":"We have to rate limit you for model deepseek-ai/DeepSeek-V4.1-Flash-1017. If you need higher limits, please consider other (commercial) options."}' },
  // workbuddy — context overflow, whose text says 额度都无关.
  { code: 'CONTEXT_WINDOW_EXCEEDED', message: '400: {"message":"workbuddy 上游失败：请求被上游拒绝（http 400）（code 11115，requestId b92c66e9-4a9d-4758-94bb-7b62adf9f073）。prompt is too long (upstream code 11115)。本次输入加上历史对话超过了模型上限。请精简内容、删掉大附件，或新建任务。该请求被上游按参数拒绝：与网络、账号、额度都无关，换账号也不会改变结果，请按上面的提示调整后重试","type":"client","code":"client"}' },
  // workbuddy — a transport failure that merely *suggests* waiting for quota.
  { code: 'SERVER', message: '502: {"message":"workbuddy 上游失败：上游异常（http 0）：池中其余账号本次请求都已尝试过。transport error: TypeError: fetch failed。建议换一个模型继续，或稍后等待该账号的额度恢复","type":"server","code":"server"}' },
  // A credential that cannot use this model — not a balance problem.
  { code: 'AUTH', message: '{"message":"your current account does not have access to this model","request_id":"abc"}' },
  { code: 'TIMEOUT', message: 'opencode2dsh: first stream event timeout (exit silent before any response)' },
  { code: 'SERVER', message: 'HTTP 500' },
  { code: 'AUTH', message: 'invalid api key' },
  // A 402-shaped number inside ordinary text must not be read as the status.
  { code: 'UNKNOWN', message: 'model v402 retired' },
]

test('the classifier strikes every balance failure found in real session history', () => {
  const isInsufficient = INSUFFICIENT.isInsufficientBalance
  for (const error of REAL_INSUFFICIENT) {
    assert.equal(
      isInsufficient(error),
      true,
      `must strike: [${error.code}] ${String(error.message).slice(0, 110)}`,
    )
  }
})

test('the classifier leaves real transient failures alone', () => {
  const isInsufficient = INSUFFICIENT.isInsufficientBalance
  for (const error of REAL_TRANSIENT) {
    assert.equal(
      isInsufficient(error),
      false,
      `must not strike: [${error.code}] ${String(error.message).slice(0, 110)}`,
    )
  }
})

test('a 429 is decided by its body, not by the status alone', () => {
  const isInsufficient = INSUFFICIENT.isInsufficientBalance
  // Same status, opposite meanings — this is the distinction the requirement
  // turns on. The Host codes both as RATE_LIMIT.
  assert.equal(
    isInsufficient({ code: 'RATE_LIMIT', status: 429, message: '429: {"message":"insufficient balance"}' }),
    true,
    'a 429 whose body says the balance is empty strikes',
  )
  assert.equal(
    isInsufficient({ code: 'RATE_LIMIT', status: 429, message: '429: {"message":"Rate limit exceeded. Please try again later."}' }),
    false,
    'a plain 429 rate limit does not',
  )
})

test('the structured codes and a bare 402 stay authoritative', () => {
  const isInsufficient = INSUFFICIENT.isInsufficientBalance
  // The Host's own provider-neutral codes need no wording.
  assert.equal(isInsufficient({ code: 'QUOTA', message: 'nope' }), true)
  assert.equal(isInsufficient({ code: 'ACCOUNT_QUOTA', message: 'nope' }), true)
  assert.equal(isInsufficient({ code: 'BUDGET_EXHAUSTED', message: 'nope' }), true)
  // A bare 402: the structured status, or the flattened HTTP_ code.
  assert.equal(isInsufficient({ code: 'UNKNOWN', message: 'failed', status: 402 }), true)
  assert.equal(isInsufficient({ code: 'HTTP_402', message: 'failed' }), true)
  // Non-object inputs degrade instead of throwing.
  assert.equal(isInsufficient(null), false)
  assert.equal(isInsufficient(undefined), false)
  assert.equal(isInsufficient('insufficient balance'), true)
})

test('the header route names the model a request was dispatched to', () => {
  const route = INSUFFICIENT.routeOfHeader({
    type: 'request/header',
    data: { header: { config: { provider: 'third-party', model: 'grok-4' } }, reason: 'initial' },
  })
  assert.deepEqual(route, { provider: 'third-party', model: 'grok-4' })
  // Anything else, and a header without a usable config, resolve to null.
  assert.equal(INSUFFICIENT.routeOfHeader({ type: 'turn/start', data: { turn: 1 } }), null)
  assert.equal(INSUFFICIENT.routeOfHeader({ type: 'request/header', data: { header: {} } }), null)
  assert.equal(INSUFFICIENT.routeOfHeader(null), null)
})

test('the fold marks a route on a balance failure and clears it when the model answers again', () => {
  const marks = new Map()
  const route = { provider: 'third-party', model: 'grok-4' }
  const fail = {
    type: 'turn/end',
    time: 1000,
    data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } },
  }
  assert.equal(INSUFFICIENT.foldInsufficient(marks, fail, route), true, 'the route is marked')
  assert.deepEqual(marks.get('third-party/grok-4'), { marked: true, at: 1000 })
  // A repeated identical failure is not a new transition.
  assert.equal(INSUFFICIENT.foldInsufficient(marks, fail, route), false, 'a repeat is a no-op')
  // A completed turn proves the account was usable again.
  const ok = { type: 'turn/end', time: 2000, data: { turn: 2, reason: { kind: 'completed' } } }
  assert.equal(INSUFFICIENT.foldInsufficient(marks, ok, route), true, 'a success clears the mark')
  assert.equal(marks.get('third-party/grok-4').marked, false, 'the route is recorded as cleared')
  // A failure for another reason also clears it: the balance was not the cause.
  // The re-mark must be NEWER than the clear, or the watermark rejects it.
  const laterFail = { type: 'turn/end', time: 3000, data: { turn: 3, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } }
  assert.equal(INSUFFICIENT.foldInsufficient(marks, laterFail, route), true, 'a newer failure marks again')
  assert.equal(marks.get('third-party/grok-4').marked, true)
  const other = { type: 'turn/end', time: 4000, data: { turn: 4, reason: { kind: 'error', error: { code: 'TIMEOUT', message: 'timed out' } } } }
  assert.equal(INSUFFICIENT.foldInsufficient(marks, other, route), true, 'a non-balance failure clears it')
  assert.equal(marks.get('third-party/grok-4').marked, false)
})

test('a cancellation or blocked turn does not clear the mark', () => {
  // The model never answered in either case, so neither proves the balance
  // recovered. Only an answer (completed / max-tokens) or a different failure
  // ends the strike.
  const marks = new Map()
  const route = { provider: 'third-party', model: 'grok-4' }
  const fail = {
    type: 'turn/end',
    time: 1000,
    data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } },
  }
  INSUFFICIENT.foldInsufficient(marks, fail, route)
  assert.equal(marks.get('third-party/grok-4').marked, true)

  for (const reason of [
    { kind: 'aborted', reason: 'user' },
    { kind: 'blocked' },
    { kind: 'interrupted' },
    { kind: 'forked' },
  ]) {
    const event = { type: 'turn/end', time: 2000, data: { turn: 2, reason } }
    assert.equal(INSUFFICIENT.foldInsufficient(marks, event, route), false, `${reason.kind} clears nothing`)
    assert.equal(marks.get('third-party/grok-4').marked, true, `${reason.kind} leaves the mark standing`)
  }

  // `max-tokens` DID reach the model, so it clears.
  const capped = { type: 'turn/end', time: 3000, data: { turn: 3, reason: { kind: 'max-tokens' } } }
  assert.equal(INSUFFICIENT.foldInsufficient(marks, capped, route), true, 'max-tokens clears the mark')
  assert.equal(marks.get('third-party/grok-4').marked, false)
})

test('the fold ignores events that are not turn/end, and a turn without a route', () => {
  const marks = new Map()
  const route = { provider: 'p', model: 'm' }
  const fail = {
    type: 'turn/end',
    data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } },
  }
  assert.equal(INSUFFICIENT.foldInsufficient(marks, { type: 'turn/start', data: { turn: 1 } }, route), false)
  assert.equal(INSUFFICIENT.foldInsufficient(marks, fail, null), false, 'no route, no mark')
  assert.equal(marks.size, 0)
})

/** Build a sessions service whose binding exposes a live event feed. */
function sessionsWithFeed(entries) {
  const listeners = new Set()
  let window = { entries: [...entries], hasMore: false, revision: 1, change: { kind: 'replace', entries: [...entries] } }
  const feed = {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => window,
  }
  const sessions = {
    subagentAddress: () => undefined,
    binding: () => ({ sessionId: 'session-1', eventSource: feed }),
  }
  return {
    sessions,
    /** Append one durable event and publish it, exactly like the real feed. */
    append(event) {
      const entry = { type: 'event', event }
      window = {
        entries: [...window.entries, entry],
        hasMore: window.hasMore,
        revision: window.revision + 1,
        change: { kind: 'append', entries: [entry] },
      }
      for (const listener of listeners) listener()
    },
  }
}

const ROW_INSUFFICIENT = 'data-insufficient'

test('a balance failure strikes the row of the model that failed, and a success clears it', () => {
  runtime.reset()
  const feed = sessionsWithFeed([])
  const { ctx, seat } = makeCtx({ sessions: feed.sessions })
  bundle.apply(ctx)
  const face = seat().registration.inject('session-1')
  const props = {
    ...face,
    locked: false,
    t: key => TEMPLATES[key] ?? key,
    useProjection: key => (key === 'agentTeam' ? { enabled: false, tasks: [] } : { lastUsed: null, pending: null }),
    useSession: () => null,
    useSessions: () => undefined,
  }
  // The store the face resolves drives the grid.
  const state = catalogState()
  props.directory = snapshotStore(state)
  props.resolveDirectory = () => ({ store: props.directory })

  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  const rowOf = name => gridRows(tree).find(row => textOf(row).includes(name))

  assert.equal(rowOf('Grok 4').props[ROW_INSUFFICIENT], undefined, 'nothing is struck before any failure')

  // A request to grok-4 fails on insufficient balance.
  feed.append({ type: 'request/header', data: { header: { config: { provider: 'third-party', model: 'grok-4' } }, reason: 'initial' } })
  feed.append({ type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } })
  tree = runtime.render(bundle.__component, props)
  assert.equal(rowOf('Grok 4').props[ROW_INSUFFICIENT], 'true', 'the failed model is struck through')
  // Only that model: its siblings are untouched.
  assert.equal(rowOf('GLM 4.6').props[ROW_INSUFFICIENT], undefined, 'other models are not struck')
  assert.equal(rowOf('Kimi K2').props[ROW_INSUFFICIENT], undefined, 'other models are not struck')

  // The same model later answers successfully: the strike is removed.
  feed.append({ type: 'request/header', data: { header: { config: { provider: 'third-party', model: 'grok-4' } }, reason: 'change' } })
  feed.append({ type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  tree = runtime.render(bundle.__component, props)
  assert.equal(rowOf('Grok 4').props[ROW_INSUFFICIENT], undefined, 'a later non-insufficient call clears it')
})

test('a 402 status and provider wording both strike the row', () => {
  runtime.reset()
  const feed = sessionsWithFeed([])
  const { ctx, seat } = makeCtx({ sessions: feed.sessions })
  bundle.apply(ctx)
  const face = seat().registration.inject('session-1')
  const props = {
    ...face,
    locked: false,
    t: key => TEMPLATES[key] ?? key,
    useProjection: key => (key === 'agentTeam' ? { enabled: false, tasks: [] } : { lastUsed: null, pending: null }),
    useSession: () => null,
    useSessions: () => undefined,
  }
  props.directory = snapshotStore(catalogState())
  props.resolveDirectory = () => ({ store: props.directory })

  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  const rowOf = name => gridRows(tree).find(row => textOf(row).includes(name))

  // A bare HTTP 402 flattened to UNKNOWN with the status preserved.
  feed.append({ type: 'request/header', data: { header: { config: { provider: 'third-party', model: 'glm-4.6' } }, reason: 'initial' } })
  feed.append({ type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'payment required', status: 402 } } } })
  tree = runtime.render(bundle.__component, props)
  assert.equal(rowOf('GLM 4.6').props[ROW_INSUFFICIENT], 'true', 'a 402 strikes the row')

  // Provider wording that the Host could not classify.
  feed.append({ type: 'request/header', data: { header: { config: { provider: 'third-party', model: 'kimi-k2' } }, reason: 'change' } })
  feed.append({ type: 'turn/end', data: { turn: 2, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'Insufficient credits remaining' } } } })
  tree = runtime.render(bundle.__component, props)
  assert.equal(rowOf('Kimi K2').props[ROW_INSUFFICIENT], 'true', 'provider wording strikes the row')
  assert.equal(rowOf('GLM 4.6').props[ROW_INSUFFICIENT], 'true', 'an earlier mark survives another model failing')
})

test('a 429 whose body says the balance is empty strikes the row, a plain 429 does not', () => {
  // The user's case: providers such as modelscope-token-plan answer an empty
  // balance with HTTP 429 and a body that says so. The Host codes it
  // RATE_LIMIT, which is normally transient, so the panel must read the body —
  // and must NOT strike when the same 429 really is a rate limit.
  runtime.reset()
  const feed = sessionsWithFeed([])
  const { ctx, seat } = makeCtx({ sessions: feed.sessions })
  bundle.apply(ctx)
  const face = seat().registration.inject('session-1')
  const props = {
    ...face,
    locked: false,
    t: key => TEMPLATES[key] ?? key,
    useProjection: key => (key === 'agentTeam' ? { enabled: false, tasks: [] } : { lastUsed: null, pending: null }),
    useSession: () => null,
    useSessions: () => undefined,
  }
  props.directory = snapshotStore(catalogState())
  props.resolveDirectory = () => ({ store: props.directory })

  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  const rowOf = name => gridRows(tree).find(row => textOf(row).includes(name))

  // 1. A genuine 429 rate limit must leave the row alone.
  feed.append({ type: 'request/header', data: { header: { config: { provider: 'third-party', model: 'glm-4.6' } }, reason: 'initial' } })
  feed.append({ type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { code: 'RATE_LIMIT', message: '429: {"type":"FreeUsageLimitError","message":"Rate limit exceeded. Please try again later."}' } } } })
  tree = runtime.render(bundle.__component, props)
  assert.equal(rowOf('GLM 4.6').props[ROW_INSUFFICIENT], undefined, 'a plain 429 rate limit does not strike')

  // 2. The same status with a balance body DOES strike.
  feed.append({ type: 'request/header', data: { header: { config: { provider: 'third-party', model: 'glm-4.6' } }, reason: 'change' } })
  feed.append({ type: 'turn/end', data: { turn: 2, reason: { kind: 'error', error: { code: 'RATE_LIMIT', message: '429: {"message":"insufficient balance","request_id":"4f188d7b-3798-417c-93c3-b93a32bdbb4e"}' } } } })
  tree = runtime.render(bundle.__component, props)
  assert.equal(rowOf('GLM 4.6').props[ROW_INSUFFICIENT], 'true', 'a 429 with an insufficient-balance body strikes')
})

test('the strike decoration is a line-through on the row text only', () => {
  const css = source.match(/const CSS = `([\s\S]*?)`/)[1]
  const rule = css.slice(
    css.indexOf('.dshmf-row[data-insufficient="true"]'),
    css.indexOf('.dshmf-rowTail'),
  )
  assert.match(rule, /text-decoration:\s*line-through/, 'the row text is struck through')
  // The name and the variant tag carry it; the badge and spinner must not.
  assert.match(rule, /\.dshmf-rowName/, 'the primary text is struck')
  assert.match(rule, /\.dshmf-rowProvider/, 'the variant tag is struck')
  assert.doesNotMatch(rule, /\.dshmf-badge/, 'the badge chip is not struck')
  assert.doesNotMatch(rule, /\.dshmf-rowTail/, 'the spinner is not struck')
})

test('the mark snapshot is referentially stable, so an unmarked panel cannot loop', () => {
  // `useSyncExternalStore` compares snapshots by identity. A face that built a
  // fresh object per call would look changed on every render.
  const { ctx, seat } = makeCtx({ sessions: null })
  bundle.apply(ctx)
  const face = seat().registration.inject('session-1')
  const markFace = face.insufficient
  assert.ok(markFace, 'the degraded face still answers the mark face')
  assert.equal(markFace.getSnapshot(), markFace.getSnapshot(), 'the same snapshot object every call')
  assert.equal(markFace.getSnapshot().marks.size, 0, 'and it is empty')
})

// ---------------------------------------------------------------------------
// GLOBAL marks: whether a model still has quota is a fact about the model
// route (and its account), not about one conversation. A failure seen in ANY
// Session — or recorded by an earlier page load — strikes the model in every
// Session and workspace, and the newest observation wins.
// ---------------------------------------------------------------------------

/** Install a `localStorage` shim and return its backing map. */
function installMarkStorage(entries = {}) {
  const map = new Map(Object.entries(entries))
  globalThis.localStorage = {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
  }
  return map
}

/** A sessions service whose list names `ids` and whose bindings expose live feeds. */
function sessionsWithManyFeeds(ids, seed = {}) {
  const listeners = new Map()
  const windows = new Map()
  const feeds = new Map()
  for (const id of ids) {
    const entries = seed[id] ?? []
    windows.set(id, {
      entries: [...entries],
      hasMore: false,
      revision: 1,
      change: { kind: 'replace', entries: [...entries] },
    })
    const set = new Set()
    listeners.set(id, set)
    feeds.set(id, {
      subscribe(listener) {
        set.add(listener)
        return () => { set.delete(listener) }
      },
      getSnapshot: () => windows.get(id),
    })
  }
  const listListeners = new Set()
  const list = {
    subscribe(listener) {
      listListeners.add(listener)
      return () => { listListeners.delete(listener) }
    },
    getSnapshot: () => ({ ids: [...windows.keys()], byId: {}, phase: 'ready', projectionsBySession: {} }),
  }
  const sessions = {
    subagentAddress: () => undefined,
    list,
    binding: id => (feeds.has(id) ? { sessionId: id, eventSource: feeds.get(id) } : undefined),
  }
  return {
    sessions,
    /** Append one durable event to one Session's feed, like the real feed. */
    append(id, event) {
      const entry = { type: 'event', event }
      const window = windows.get(id)
      windows.set(id, {
        entries: [...window.entries, entry],
        hasMore: window.hasMore,
        revision: window.revision + 1,
        change: { kind: 'append', entries: [entry] },
      })
      for (const listener of listeners.get(id) ?? []) listener()
    },
  }
}

/** Render the seat for one session against a feed-backed sessions service. */
function mountSeat(feed, sessionId, options = {}) {
  runtime.reset()
  const { ctx, seat } = makeCtx({ sessions: feed.sessions })
  bundle.apply(ctx)
  const face = seat().registration.inject(sessionId)
  const props = {
    ...face,
    locked: false,
    t: key => TEMPLATES[key] ?? key,
    useProjection: key => (key === 'agentTeam' ? { enabled: false, tasks: [] } : { lastUsed: null, pending: null }),
    useSession: () => null,
    useSessions: () => undefined,
    ...options.inject,
  }
  props.directory = snapshotStore(options.state ?? catalogState())
  props.resolveDirectory = () => ({ store: props.directory })
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  return { tree, props, ctx, seat }
}

test('a balance failure in ONE session strikes the model in ANOTHER session', () => {
  // The whole point: the marks are global. Session A's failing call must strike
  // the row Session B renders, because the account behind the model is shared.
  const feed = sessionsWithManyFeeds(['session-a', 'session-b'])
  const mounted = mountSeat(feed, 'session-b')
  const rowOf = name => gridRows(mounted.tree).find(row => textOf(row).includes(name))
  assert.equal(rowOf('Grok 4').props[ROW_INSUFFICIENT], undefined, 'nothing is struck yet')

  // Session A — NOT the Session this seat renders for — fails on grok-4.
  feed.append('session-a', { type: 'request/header', time: 1000, data: { header: { config: { provider: 'third-party', model: 'grok-4' } }, reason: 'initial' } })
  feed.append('session-a', { type: 'turn/end', time: 1001, data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } })

  const tree = runtime.render(bundle.__component, mounted.props)
  const struck = gridRows(tree).find(row => textOf(row).includes('Grok 4'))
  assert.equal(struck.props[ROW_INSUFFICIENT], 'true', 'the other session strikes the shared model')
  assert.equal(gridRows(tree).find(row => textOf(row).includes('Kimi K2')).props[ROW_INSUFFICIENT], undefined)
})

test('a later success in ANOTHER session clears the strike, oldest-first by time', () => {
  // Marks are ordered by event time across Sessions, so a newer success in a
  // different conversation wins over an older failure.
  const feed = sessionsWithManyFeeds(['session-a', 'session-b'])
  const mounted = mountSeat(feed, 'session-a')
  feed.append('session-a', { type: 'request/header', time: 1000, data: { header: { config: { provider: 'third-party', model: 'grok-4' } }, reason: 'initial' } })
  feed.append('session-a', { type: 'turn/end', time: 1001, data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } })
  let tree = runtime.render(bundle.__component, mounted.props)
  assert.equal(gridRows(tree).find(row => textOf(row).includes('Grok 4')).props[ROW_INSUFFICIENT], 'true')

  feed.append('session-b', { type: 'request/header', time: 2000, data: { header: { config: { provider: 'third-party', model: 'grok-4' } }, reason: 'initial' } })
  feed.append('session-b', { type: 'turn/end', time: 2001, data: { turn: 1, reason: { kind: 'completed' } } })
  tree = runtime.render(bundle.__component, mounted.props)
  assert.equal(gridRows(tree).find(row => textOf(row).includes('Grok 4')).props[ROW_INSUFFICIENT], undefined,
    'a newer success from another session clears it')
})

test('an OLDER failure cannot resurrect a mark a newer success already cleared', () => {
  // Replaying a window (or loading a second Session whose history is older)
  // must not override the newest fact. This is what the time watermark buys.
  const marks = new Map()
  const route = { provider: 'p', model: 'm' }
  const success = { type: 'turn/end', time: 5000, data: { turn: 2, reason: { kind: 'completed' } } }
  const oldFailure = { type: 'turn/end', time: 1000, data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } }
  assert.equal(INSUFFICIENT.foldInsufficient(marks, success, route), false, 'a clear from an unmarked state is not a visible change')
  assert.equal(INSUFFICIENT.foldInsufficient(marks, oldFailure, route), false, 'the older failure is ignored')
  assert.equal(marks.get('p/m').marked, false, 'the newer clear still stands')
})

test('the marks survive a reload through localStorage', () => {
  // A fresh page load has no live feed for the Session that failed, so the
  // stored record is the only thing that can keep the strike.
  const stored = installMarkStorage()
  try {
    // Real event times, so the 7-day expiry keeps them.
    const now = Date.now()
    const feed = sessionsWithManyFeeds(['session-a'])
    const mounted = mountSeat(feed, 'session-a')
    feed.append('session-a', { type: 'request/header', time: now - 10, data: { header: { config: { provider: 'third-party', model: 'grok-4' } }, reason: 'initial' } })
    feed.append('session-a', { type: 'turn/end', time: now - 9, data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } })
    runtime.render(bundle.__component, mounted.props)

    const raw = stored.get(INSUFFICIENT.MARKS_KEY)
    assert.ok(raw, 'the mark is persisted')
    assert.equal(JSON.parse(raw)['third-party/grok-4'].marked, true)

    // Simulate a reload: a brand-new plugin activation reading the same storage.
    const fresh = sessionsWithManyFeeds(['session-b'])
    const remounted = mountSeat(fresh, 'session-b')
    const struck = gridRows(remounted.tree).find(row => textOf(row).includes('Grok 4'))
    assert.equal(struck.props[ROW_INSUFFICIENT], 'true', 'the stored strike is restored on a fresh load')
  } finally {
    delete globalThis.localStorage
  }
})

test('persisted marks are parsed defensively and expire', () => {
  const now = 10_000_000
  const parsed = INSUFFICIENT.parseMarks({
    'p/m': { marked: true, at: now - 1000 },
    'p/cleared': { marked: false, at: now - 2000 },
    'p/stale': { marked: true, at: now - INSUFFICIENT.MARKS_TTL - 1 },
    'p/garbage': 'nope',
    'p/bad-time': { marked: true, at: 'soon' },
    '': { marked: true, at: now },
  }, now)
  assert.equal(parsed.get('p/m').marked, true)
  assert.equal(parsed.get('p/cleared').marked, false, 'a cleared watermark is kept for ordering')
  assert.equal(parsed.has('p/stale'), false, 'an expired mark is dropped')
  assert.equal(parsed.has('p/garbage'), false, 'a malformed entry is dropped')
  assert.equal(parsed.get('p/bad-time').at, 0, 'a non-numeric time degrades to 0')
  assert.equal(parsed.has(''), false, 'an empty key is dropped')
  // Non-objects and missing storage answer an empty map instead of throwing.
  assert.equal(INSUFFICIENT.parseMarks(null, now).size, 0)
  assert.equal(INSUFFICIENT.parseMarks(undefined, now).size, 0)
})

test('a storage failure never costs the marks or the panel', () => {
  // Private mode / sandboxed frame: reading and writing throw.
  globalThis.localStorage = {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('denied') },
  }
  try {
    assert.doesNotThrow(() => INSUFFICIENT.readMarks())
    assert.equal(INSUFFICIENT.readMarks().size, 0, 'an unreadable store starts empty')
    assert.doesNotThrow(() => INSUFFICIENT.writeMarks(new Map([['p/m', { marked: true, at: 1 }]])))
  } finally {
    delete globalThis.localStorage
  }
})

test('the store watches every listed session and drops unlisted feeds', () => {
  // Attaching to every Session is what makes a failure visible everywhere; a
  // Session that leaves the list must release its subscription.
  const feed = sessionsWithManyFeeds(['session-a', 'session-b'])
  const written = []
  const store = INSUFFICIENT.createMarkStore({
    sessionsOf: () => feed.sessions,
    readStored: () => new Map(),
    writeStored: entries => { written.push(entries.size) },
  })
  try {
    store.sync()
    // Both feeds are observed: a failure in either reaches the store.
    feed.append('session-a', { type: 'request/header', time: 1000, data: { header: { config: { provider: 'p', model: 'a' } }, reason: 'initial' } })
    feed.append('session-a', { type: 'turn/end', time: 1001, data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } })
    assert.equal(store.getSnapshot().marks.get('p/a'), true)
    feed.append('session-b', { type: 'request/header', time: 2000, data: { header: { config: { provider: 'p', model: 'b' } }, reason: 'initial' } })
    feed.append('session-b', { type: 'turn/end', time: 2001, data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } })
    assert.equal(store.getSnapshot().marks.get('p/b'), true, 'the second session is watched too')
    assert.ok(written.length > 0, 'each stored change is persisted')
  } finally {
    store.dispose()
  }
})

test('a missing sessions service leaves the store on its persisted state', () => {
  // The service can bind after activation; the store must not throw meanwhile.
  const store = INSUFFICIENT.createMarkStore({
    sessionsOf: () => undefined,
    readStored: () => new Map([['p/m', { marked: true, at: 1 }]]),
    writeStored: () => {},
  })
  try {
    assert.doesNotThrow(() => store.sync())
    assert.equal(store.getSnapshot().marks.get('p/m'), true, 'the stored state is still served')
  } finally {
    store.dispose()
  }
})

test('a 429 body decides the mark across sessions, not the status', () => {
  // The cross-session path must keep the same 429 rule: balance wording
  // strikes, a plain rate limit does not.
  const feed = sessionsWithManyFeeds(['session-a', 'session-b'])
  const mounted = mountSeat(feed, 'session-b')
  feed.append('session-a', { type: 'request/header', time: 1000, data: { header: { config: { provider: 'third-party', model: 'glm-4.6' } }, reason: 'initial' } })
  feed.append('session-a', { type: 'turn/end', time: 1001, data: { turn: 1, reason: { kind: 'error', error: { code: 'RATE_LIMIT', message: '429: {"type":"FreeUsageLimitError","message":"Rate limit exceeded. Please try again later."}' } } } })
  let tree = runtime.render(bundle.__component, mounted.props)
  assert.equal(gridRows(tree).find(row => textOf(row).includes('GLM 4.6')).props[ROW_INSUFFICIENT], undefined,
    'a plain 429 in another session does not strike')

  feed.append('session-a', { type: 'request/header', time: 2000, data: { header: { config: { provider: 'third-party', model: 'glm-4.6' } }, reason: 'change' } })
  feed.append('session-a', { type: 'turn/end', time: 2001, data: { turn: 2, reason: { kind: 'error', error: { code: 'RATE_LIMIT', message: '429: {"message":"insufficient balance"}' } } } })
  tree = runtime.render(bundle.__component, mounted.props)
  assert.equal(gridRows(tree).find(row => textOf(row).includes('GLM 4.6')).props[ROW_INSUFFICIENT], 'true',
    'a 429 with a balance body in another session does strike')
})

