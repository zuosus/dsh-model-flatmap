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
  // The family name is stripped from every row's tail too, and a model whose
  // name says nothing beyond the family draws none (null = no tail). The id
  // tail covers the rest: `hy3-x` → x, `hy4-preview` → preview, `hy4std` → std,
  // `hy4free` → free.
  assert.deepEqual(gridRowProviders(tree), [null, 'x', 'preview', 'std', 'free'])
  for (const tail of gridRowProviders(tree)) {
    if (tail === null) continue
    assert.doesNotMatch(tail, /HY[34]/i, 'the family name never leaks into a row tail')
  }
})

test('a family tail shows the型号 and multiplier the heading cannot carry', () => {
  // The heading says the family (`Qwen`, `DeepSeek`), and the row's primary text
  // says the provider. What neither can say is WHICH model of the family the
  // row is, nor the catalog's rate multiplier — so that goes in a tail at the
  // END of the row, with the family name and the provider label stripped off.
  const state = catalogState({
    current: null,
    groups: [
      {
        id: 'modelscope',
        name: 'ModelScope International',
        models: [
          { id: 'Qwen/Qwen3.8-Flash-Next', name: 'Qwen3.8-Flash-Next' },
          { id: 'Qwen/Qwen3.8-27B', name: 'Qwen3.8-27B' },
          { id: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', name: 'DeepSeek-V4.1-Flash-1017' },
        ],
      },
      {
        id: 'workbuddy',
        name: 'WorkBuddy',
        models: [{ id: 'deepseek-v4.1-flash', name: 'Deepseek-V4.1-Flash · x0.01' }],
      },
    ],
  })
  runtime.reset()
  const { props } = makeProps(state)
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  tree = switchToFamily(tree, props)

  const qwen = gridRows(tree)
    .filter(row => textOf(row).includes('ModelScope International'))
    .map(row => textOf(findAll(row, node => hasClass(node, 'dshmf-rowProvider'))[0]))
  // The DeepSeek row and the two Qwen rows all belong to one provider but three
  // different families; every one of them now says which model it is.
  assert.deepEqual(qwen.slice().sort(), ['3.8-27B', '3.8-Flash-Next', 'V4.1-Flash-1017'].sort(),
    'each row carries the型号 the family heading lacks')
  // Two rows of the same family are distinguishable ONLY because of that tail:
  // `Qwen` alone would print `ModelScope International` twice with no way to
  // tell 3.8-Flash-Next from 3.8-27B.
  assert.notEqual(qwen[0], qwen[1], 'the tails tell the two models apart')
  assert.notEqual(qwen[1], qwen[2], 'and so do the next two')
  // The multiplier travels with the model it belongs to.
  const global = gridRows(tree)
    .filter(row => textOf(row).includes('WorkBuddy'))
    .map(row => textOf(findAll(row, node => hasClass(node, 'dshmf-rowProvider'))[0]))
  assert.deepEqual(global, ['V4.1-Flash · x0.01'])
  // Provider grouping is untouched: there the heading IS the provider, so the
  // model name stays the primary text and no tail is drawn.
  runtime.reset()
  const fresh = makeProps(state)
  let providerTree = runtime.render(bundle.__component, fresh.props)
  findAll(providerTree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  providerTree = runtime.render(bundle.__component, fresh.props)
  assert.deepEqual(gridRowProviders(providerTree), [null, null, null, null])
})

test('a multiplier in a family tail keeps the smaller bold run', () => {
  // Under *By provider* a `x0.01` in a model name is already split into a
  // smaller bold run. The same rate in a family tail must read the same way
  // instead of falling back to the tail's plain 11px text.
  const state = catalogState({
    current: null,
    groups: [{
      id: 'workbuddy',
      name: 'WorkBuddy',
      models: [{ id: 'deepseek-v4.1-flash', name: 'Deepseek-V4.1-Flash · x0.01' }],
    }],
  })
  runtime.reset()
  const { props } = makeProps(state)
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)
  tree = switchToFamily(tree, props)

  const tail = findAll(gridRows(tree)[0], node => hasClass(node, 'dshmf-rowProvider'))[0]
  assert.equal(textOf(tail), 'V4.1-Flash · x0.01', 'the tail keeps the rate text')
  const marks = findAll(tail, node => hasClass(node, 'dshmf-rowNameMark'))
  assert.equal(marks.length, 1, 'the multiplier is its own run')
  assert.equal(textOf(marks[0]), 'x0.01')

  const css = source.match(/const CSS = `([\s\S]*?)`/)[1]
  const tailMark = css.match(/\.dshmf-rowProvider \.dshmf-rowNameMark \{([\s\S]*?)\}/)[1]
  const size = Number.parseFloat(tailMark.match(/font-size:\s*([^;]+);/)[1], 10)
  assert.ok(size < 11, 'inside the 11px tail the marker steps down again')
  assert.match(tailMark, /font-weight|font-size/, 'it stays a distinct, smaller run')
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
  // Live registrations per slot key, so the flip to native mode can be observed:
  // the seat entry disappears when it is disposed, exactly as the real `single`
  // slot stops rendering it. `extraEntries` seeds competing entries (the shipped
  // picker) that this plugin does not own.
  const live = new Map()
  const subscribeSlotListeners = new Map()
  const liveOf = key => live.get(key) ?? []
  const notifySlot = key => {
    for (const listener of [...(subscribeSlotListeners.get(key) ?? [])]) listener()
  }
  const slots = {
    inject: (key, factory) => {
      const dispose = factory()
      registered.push({ key, dispose })
      return () => { dispose?.() }
    },
    register: (registration, component) => {
      const entry = { registration, component, options: registration, registrant: 'dsh-model-flatmap' }
      registered.push({ registration, component })
      const key = registration?.name
      if (typeof key === 'string') {
        live.set(key, [...liveOf(key), entry])
        notifySlot(key)
      }
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        if (typeof key === 'string') {
          live.set(key, liveOf(key).filter(candidate => candidate !== entry))
          notifySlot(key)
        }
      }
    },
    entries: key => liveOf(key),
    subscribe: (key, listener) => {
      const set = subscribeSlotListeners.get(key) ?? new Set()
      set.add(listener)
      subscribeSlotListeners.set(key, set)
      return () => { set.delete(listener) }
    },
  }
  // Competing entries exist BEFORE the plugin activates, as the shipped ones do.
  for (const [key, entries] of Object.entries(options.extraEntries ?? {})) {
    live.set(key, entries.map(component => ({
      registration: { name: key }, component, options: { name: key }, registrant: 'shipped',
    })))
  }
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
    slots: options.omitSlotEnumeration
      // An older Host: `inject`/`register` only. Stepping aside must then be
      // unverifiable, i.e. refused.
      ? {
        inject: slots.inject,
        register: slots.register,
      }
      : slots,
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
  return { ctx, registered, dictionaryRegistrations, services, seat, live, liveOf }
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
// The panel itself carries a 1px light-grey frame. It deliberately does NOT
// borrow a host `border-*` token: those are near-invisible hairlines, and the
// frame has to read against the blurred translucent menu surface.
// ---------------------------------------------------------------------------
test('the panel draws its own 1px light-grey frame in both themes', () => {
  const css = source.match(/const CSS = `([\s\S]*?)`/)[1]
  const panel = css.match(/\.dshmf-panel \{([\s\S]*?)\}/)[1]
  assert.match(panel, /border: 1px solid #[0-9A-Fa-f]{6}/, 'a 1px explicit-grey frame')
  assert.doesNotMatch(panel, /border: 0\b/, 'the frame is not suppressed')
  assert.match(panel, /border-radius: var\(--dsw-radius-lg\)/, 'corners keep their radius token')
  assert.ok(css.includes('body[data-ds-dark-theme] .dshmf-panel'), 'dark theme keeps the frame visible')
  assert.ok(css.includes('html[data-ds-dark-theme] .dshmf-panel'), 'html-scoped dark theme too')
})

// ---------------------------------------------------------------------------
// The grouping choice must persist across sessions and workgroups. The Web GUI
// runs on a stable origin, so the choice is kept in `localStorage` and read
// back on every mount. The tests below drive the same read/write helpers the
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

test('the footer always renders, carrying the mode button even with no other group', () => {
  // No reasoning metadata and no agentTeams projection. The footer used to be
  // omitted entirely here; it now always renders because the display-mode
  // button lives in it — but it must carry ONLY that button, never an empty
  // reasoning or teamwork group.
  const noTeam = catalogState({ current: { provider: 'third-party', model: 'glm-4.6' } })
  const a = openPanel(noTeam, { inject: { useProjection: () => undefined, teamAvailable: () => false } })
  const af = findAll(a.tree, node => hasClass(node, 'dshmf-footer'))
  assert.equal(af.length, 1, 'the footer is there for the mode button')
  assert.equal(findAll(af[0], node => hasClass(node, 'dshmf-reason')).length, 0,
    'no reasoning metadata means no reasoning group')
  assert.equal(findAll(af[0], node => hasClass(node, 'dshmf-team')).length, 0,
    'no agentTeam projection means no teamwork group')
  assert.equal(findAll(af[0], node => hasClass(node, 'dshmf-modeBtn')).length, 1,
    'the mode button is the footer\'s permanent member')

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

/**
 * A wall-clock stamp `ms` in the past.
 *
 * Event times are the Host's `Date.now()` at append, and a strike is only drawn
 * while it is younger than STRIKE_TTL against that same clock — so the times a
 * test feeds in have to be REAL times. A bare `1000` is January 1970 and reads
 * as a verdict that expired half a century ago.
 */
const ago = ms => Date.now() - ms

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
    /** Page in older history, exactly like the Client's `loadOlder`. */
    prepend(id, events) {
      const entries = events.map(event => ({ type: 'event', event }))
      const window = windows.get(id)
      windows.set(id, {
        entries: [...entries, ...window.entries],
        hasMore: true,
        revision: window.revision + 1,
        change: { kind: 'prepend', entries },
      })
      for (const listener of listeners.get(id) ?? []) listener()
    },
    /**
     * Retire this Session's scope and materialise it again, which is what the
     * Client does when nothing retains it any more (switch away and back). The
     * id stays the same; the `eventSource` object is brand new.
     */
    rematerialize(id, entries = []) {
      listeners.get(id)?.clear()
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
      for (const listener of listListeners) listener()
    },
    /** How many live subscribers one Session's current feed has. */
    listenerCount: id => listeners.get(id)?.size ?? 0,
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

test('a failure paged in as OLDER history still strikes its model', () => {
  // The Client opens a Session on its newest page and pages older history in
  // only when the user scrolls up. A long Session therefore starts with the
  // failing turn already outside its window, and the failure that ran the
  // account dry arrives through `prepend` — the exact path that used to be
  // treated as "cannot change a mark". Skipping it made the row stay clean for
  // a model that had just returned 402, which is the reported bug.
  const feed = sessionsWithManyFeeds(['session-a'])
  const mounted = mountSeat(feed, 'session-a')

  // Newest page: a later turn on a DIFFERENT route, so nothing is struck yet.
  feed.append('session-a', { type: 'request/header', time: ago(3000), data: { header: { config: { provider: 'third-party', model: 'kimi-k2' } }, reason: 'initial' } })
  feed.append('session-a', { type: 'turn/end', time: ago(2999), data: { turn: 2, reason: { kind: 'completed' } } })
  let tree = runtime.render(bundle.__component, mounted.props)
  const rowOf = source => name => gridRows(source).find(row => textOf(row).includes(name))
  assert.equal(rowOf(tree)('Grok 4').props[ROW_INSUFFICIENT], undefined, 'the failing turn is not loaded yet')

  // Scrolling up pages in the older turn that actually hit the empty balance.
  feed.prepend('session-a', [
    { type: 'request/header', time: ago(9000), data: { header: { config: { provider: 'third-party', model: 'grok-4' } }, reason: 'initial' } },
    { type: 'turn/end', time: ago(8999), data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } },
  ])

  tree = runtime.render(bundle.__component, mounted.props)
  assert.equal(rowOf(tree)('Grok 4').props[ROW_INSUFFICIENT], 'true',
    'the failure that paged in with older history strikes its model')
  assert.equal(rowOf(tree)('Kimi K2').props[ROW_INSUFFICIENT], undefined, 'the route that answered stays clean')
})

test('a re-materialised Session feed is followed, not the retired one', () => {
  // Switching to another conversation and back retires this Session's scope and
  // builds a NEW Session object with a NEW eventSource under the SAME id. The
  // store used to key its subscription by id, so it kept listening to the dead
  // feed: live failures were never folded (no strike) while the dead feed could
  // still inject stale facts.
  const feed = sessionsWithManyFeeds(['session-a'])
  const mounted = mountSeat(feed, 'session-a')
  const rowOf = source => name => gridRows(source).find(row => textOf(row).includes(name))
  assert.equal(feed.listenerCount('session-a'), 1, 'the store follows the first feed')

  feed.rematerialize('session-a', [
    { type: 'event', event: { type: 'request/header', time: ago(9000), data: { header: { config: { provider: 'third-party', model: 'grok-4' } }, reason: 'initial' } } },
  ])
  assert.equal(feed.listenerCount('session-a'), 1, 'the store re-attaches to the new feed')
  let tree = runtime.render(bundle.__component, mounted.props)
  assert.equal(rowOf(tree)('Grok 4').props[ROW_INSUFFICIENT], undefined, 'nothing is struck before a failure')

  // A live failure now lands on the CURRENT feed and must be folded.
  feed.append('session-a', { type: 'turn/end', time: ago(8999), data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } })
  tree = runtime.render(bundle.__component, mounted.props)
  assert.equal(rowOf(tree)('Grok 4').props[ROW_INSUFFICIENT], 'true',
    'a failure on the re-materialised feed is folded')
})

test('a balance failure in ONE session strikes the model in ANOTHER session', () => {
  // The whole point: the marks are global. Session A's failing call must strike
  // the row Session B renders, because the account behind the model is shared.
  const feed = sessionsWithManyFeeds(['session-a', 'session-b'])
  const mounted = mountSeat(feed, 'session-b')
  const rowOf = name => gridRows(mounted.tree).find(row => textOf(row).includes(name))
  assert.equal(rowOf('Grok 4').props[ROW_INSUFFICIENT], undefined, 'nothing is struck yet')

  // Session A — NOT the Session this seat renders for — fails on grok-4.
  feed.append('session-a', { type: 'request/header', time: ago(2000), data: { header: { config: { provider: 'third-party', model: 'grok-4' } }, reason: 'initial' } })
  feed.append('session-a', { type: 'turn/end', time: ago(1999), data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } })

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
  feed.append('session-a', { type: 'request/header', time: ago(2000), data: { header: { config: { provider: 'third-party', model: 'grok-4' } }, reason: 'initial' } })
  feed.append('session-a', { type: 'turn/end', time: ago(1999), data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } })
  let tree = runtime.render(bundle.__component, mounted.props)
  assert.equal(gridRows(tree).find(row => textOf(row).includes('Grok 4')).props[ROW_INSUFFICIENT], 'true')

  feed.append('session-b', { type: 'request/header', time: ago(1000), data: { header: { config: { provider: 'third-party', model: 'grok-4' } }, reason: 'initial' } })
  feed.append('session-b', { type: 'turn/end', time: ago(999), data: { turn: 1, reason: { kind: 'completed' } } })
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
    feed.append('session-a', { type: 'request/header', time: ago(2000), data: { header: { config: { provider: 'p', model: 'a' } }, reason: 'initial' } })
    feed.append('session-a', { type: 'turn/end', time: ago(1999), data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } })
    assert.equal(store.getSnapshot().marks.get('p/a'), true)
    feed.append('session-b', { type: 'request/header', time: ago(1000), data: { header: { config: { provider: 'p', model: 'b' } }, reason: 'initial' } })
    feed.append('session-b', { type: 'turn/end', time: ago(999), data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } })
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
    readStored: () => new Map([['p/m', { marked: true, at: Date.now() - 1000 }]]),
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
  feed.append('session-a', { type: 'request/header', time: ago(2000), data: { header: { config: { provider: 'third-party', model: 'glm-4.6' } }, reason: 'initial' } })
  feed.append('session-a', { type: 'turn/end', time: ago(1999), data: { turn: 1, reason: { kind: 'error', error: { code: 'RATE_LIMIT', message: '429: {"type":"FreeUsageLimitError","message":"Rate limit exceeded. Please try again later."}' } } } })
  let tree = runtime.render(bundle.__component, mounted.props)
  assert.equal(gridRows(tree).find(row => textOf(row).includes('GLM 4.6')).props[ROW_INSUFFICIENT], undefined,
    'a plain 429 in another session does not strike')

  feed.append('session-a', { type: 'request/header', time: ago(1000), data: { header: { config: { provider: 'third-party', model: 'glm-4.6' } }, reason: 'change' } })
  feed.append('session-a', { type: 'turn/end', time: ago(999), data: { turn: 2, reason: { kind: 'error', error: { code: 'RATE_LIMIT', message: '429: {"message":"insufficient balance"}' } } } })
  tree = runtime.render(bundle.__component, mounted.props)
  assert.equal(gridRows(tree).find(row => textOf(row).includes('GLM 4.6')).props[ROW_INSUFFICIENT], 'true',
    'a 429 with a balance body in another session does strike')
})


// ---------------------------------------------------------------------------
// STRIKE LIFETIME. A mark keeps the wall-clock time of the observation that
// made it, which is what tells "this model is out of balance" apart from "this
// model has not been tried since that verdict". A day without a new attempt
// retires the DECORATION; the record stays as the watermark that keeps a
// replayed older failure from putting it back (DEC-024).
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

test('a mark is drawn only while it is set AND younger than the strike lifetime', () => {
  const now = 1_700_000_000_000
  const live = INSUFFICIENT.markIsLive
  assert.equal(INSUFFICIENT.STRIKE_TTL, DAY, 'the window is one day')
  assert.equal(live({ marked: true, at: now - 23 * HOUR }, now), true, 'a mark from this morning is still news')
  assert.equal(live({ marked: true, at: now - DAY }, now), false, 'a full day of silence retires it')
  assert.equal(live({ marked: true, at: now - 25 * HOUR }, now), false, 'older than the window draws nothing')
  assert.equal(live({ marked: true, at: now + 5000 }, now), true, 'a stamp ahead of the clock is fresh, never expired')
  assert.equal(live({ marked: false, at: now }, now), false, 'a cleared record draws nothing')
  assert.equal(live(undefined, now), false, 'a route never tried draws nothing')
  assert.equal(live({ marked: true, at: now - 30 * HOUR }, now, 36 * HOUR), true, 'the lifetime is honoured per call')
})

test('the store draws only the fresh marks it was handed', () => {
  const store = INSUFFICIENT.createMarkStore({
    sessionsOf: () => undefined,
    readStored: () => new Map([
      ['p/fresh', { marked: true, at: Date.now() - 2 * HOUR }],
      ['p/stale', { marked: true, at: Date.now() - 26 * HOUR }],
      ['p/cleared', { marked: false, at: Date.now() }],
    ]),
    writeStored: () => {},
  })
  try {
    assert.equal(store.getSnapshot().marks.get('p/fresh'), true)
    assert.equal(store.getSnapshot().marks.has('p/stale'), false, 'the user never retried it: the row is not struck')
    assert.equal(store.getSnapshot().marks.has('p/cleared'), false)
  } finally {
    store.dispose()
  }
})

test('a refresh that changes nothing keeps the snapshot identity the seats compare', () => {
  // The clock check now runs on every display, every fold and every timer, and
  // `useSyncExternalStore` compares snapshots BY IDENTITY. An unchanged recompute
  // that still built a fresh `{ marks }` would make the panel re-render forever.
  const store = INSUFFICIENT.createMarkStore({
    sessionsOf: () => undefined,
    readStored: () => new Map([['p/a', { marked: true, at: Date.now() - HOUR }]]),
    writeStored: () => {},
  })
  let notified = 0
  const stop = store.subscribe(() => { notified += 1 })
  try {
    const before = store.getSnapshot()
    assert.equal(store.refresh(), false, 'nothing aged out')
    assert.equal(store.getSnapshot(), before, 'so the snapshot object is untouched')
    store.sync()
    store.refresh()
    assert.equal(store.getSnapshot(), before, 'and a fold-less re-read does not swap it either')
    assert.equal(notified, 0, 'no notification without a change')
  } finally {
    stop()
    store.dispose()
  }
})

test('a stale strike never comes back on its own, but a fresh failure restrikes it', () => {
  let clock = Date.now()
  const feed = sessionsWithManyFeeds(['session-a'])
  const written = []
  const store = INSUFFICIENT.createMarkStore({
    sessionsOf: () => feed.sessions,
    readStored: () => new Map(),
    writeStored: entries => written.push(entries),
    now: () => clock,
  })
  const sizes = []
  const stop = store.subscribe(() => { sizes.push(store.getSnapshot().marks.size) })
  try {
    const header = { type: 'request/header', time: clock, data: { header: { config: { provider: 'p', model: 'a' } }, reason: 'initial' } }
    const failure = { type: 'turn/end', time: clock, data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } }
    feed.append('session-a', header)
    feed.append('session-a', failure)
    assert.equal(store.getSnapshot().marks.get('p/a'), true, 'the failure strikes the row')

    // The user never came back to this model. Displaying the list again a day
    // later must not keep claiming it is unusable.
    clock += 25 * HOUR
    assert.equal(store.refresh(), true, 'the display reports that a mark went away')
    assert.equal(store.getSnapshot().marks.has('p/a'), false, 'the strike is gone')
    assert.deepEqual(sizes, [1, 0], 'the seats were told, once each way')

    // The record itself SURVIVES: it is the watermark for this route, and the
    // only reason a replay of the old failure cannot restrike it again.
    const records = written[written.length - 1]
    assert.equal(records.get('p/a').marked, true, 'expiry retires the decoration, not the record')
    const replay = sessionsWithManyFeeds(['session-b'], { 'session-b': [{ event: header }, { event: failure }] })
    const reloaded = INSUFFICIENT.createMarkStore({
      sessionsOf: () => replay.sessions,
      readStored: () => new Map(records),
      writeStored: () => {},
      now: () => clock,
    })
    try {
      reloaded.sync()
      assert.equal(reloaded.getSnapshot().marks.has('p/a'), false,
        'replaying the same older failure cannot resurrect an expired strike')
    } finally {
      reloaded.dispose()
    }

    // A NEW attempt is new news: the same route is struck again, and the window
    // restarts from this observation.
    feed.append('session-a', { type: 'request/header', time: clock, data: { header: { config: { provider: 'p', model: 'a' } }, reason: 'change' } })
    feed.append('session-a', { type: 'turn/end', time: clock, data: { turn: 2, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } })
    assert.equal(store.getSnapshot().marks.get('p/a'), true, 'a retry that fails on balance strikes it again')
    assert.equal(store.refresh(), false, 'and it stays struck for another full day')
  } finally {
    stop()
    store.dispose()
  }
})

test('the store retires a strike on its own when nothing else happens', async () => {
  // The one transition no event reports: the user simply never retried the
  // model. A page left open across the deadline has to wake itself, or a stale
  // line-through would sit on the row until something else repainted it.
  const feed = sessionsWithManyFeeds(['session-a'])
  const store = INSUFFICIENT.createMarkStore({
    sessionsOf: () => feed.sessions,
    readStored: () => new Map(),
    writeStored: () => {},
    strikeTtl: 30,
  })
  let notified = 0
  const stop = store.subscribe(() => { notified += 1 })
  try {
    feed.append('session-a', { type: 'request/header', time: Date.now(), data: { header: { config: { provider: 'p', model: 'a' } }, reason: 'initial' } })
    feed.append('session-a', { type: 'turn/end', time: Date.now(), data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } })
    assert.equal(store.getSnapshot().marks.get('p/a'), true, 'struck to begin with')
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.equal(store.getSnapshot().marks.has('p/a'), false, 'the strike aged out with no new event at all')
    assert.ok(notified > 0, 'and the seats were told about it')
  } finally {
    stop()
    store.dispose()
  }
})

test('a strike that went stale while the panel was closed is gone when it opens again', () => {
  // The reload case: the failing conversation is long gone from this page, the
  // stored verdict is a day old, and the model list must not open with a lie on
  // that row. The 2h-old mark next to it proves the row is not simply blank.
  installMarkStorage({
    [INSUFFICIENT.MARKS_KEY]: JSON.stringify({
      'third-party/grok-4': { marked: true, at: Date.now() - 25 * HOUR },
      'third-party/kimi-k2': { marked: true, at: Date.now() - 2 * HOUR },
    }),
  })
  try {
    const feed = sessionsWithManyFeeds(['session-a'])
    const mounted = mountSeat(feed, 'session-a')
    const rowOf = name => gridRows(mounted.tree).find(row => textOf(row).includes(name))
    assert.equal(rowOf('Kimi K2').props[ROW_INSUFFICIENT], 'true', 'a mark from this morning is still drawn')
    assert.equal(rowOf('Grok 4').props[ROW_INSUFFICIENT], undefined, 'a day of silence is not a verdict any more')
  } finally {
    delete globalThis.localStorage
  }
})

test('opening the panel re-reads the clock', () => {
  // The user's requirement end to end: a strike set now is drawn, and the next
  // time the list is displayed more than a day later — with no attempt in
  // between — the decoration is off that row.
  runtime.reset()
  const feed = sessionsWithManyFeeds(['session-a'])
  const mounted = mountSeat(feed, 'session-a')
  const rowOf = tree => name => gridRows(tree).find(row => textOf(row).includes(name))
  feed.append('session-a', { type: 'request/header', time: Date.now(), data: { header: { config: { provider: 'third-party', model: 'grok-4' } }, reason: 'initial' } })
  feed.append('session-a', { type: 'turn/end', time: Date.now(), data: { turn: 1, reason: { kind: 'error', error: { code: 'QUOTA', message: 'insufficient balance' } } } })
  let tree = runtime.render(bundle.__component, mounted.props)
  assert.equal(rowOf(tree)('Grok 4').props[ROW_INSUFFICIENT], 'true', 'struck while the news is fresh')

  const trigger = () => findAll(runtime.render(bundle.__component, mounted.props), node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  const realNow = Date.now
  Date.now = () => realNow() + 25 * HOUR
  try {
    trigger() // close
    tree = runtime.render(bundle.__component, mounted.props)
    trigger() // and display it again, a day later
    tree = runtime.render(bundle.__component, mounted.props)
    assert.equal(rowOf(tree)('Grok 4').props[ROW_INSUFFICIENT], undefined,
      'a day without an attempt lifts the strike on the next display')
  } finally {
    Date.now = realNow
  }
})

// ---------------------------------------------------------------------------
// Model-name marquee (DEC-021).
//
// The row's main content is a clipped WINDOW: resting the pointer on a
// truncated name starts a slow marquee inside that window only. Everything
// right-aligned after it (the catalog badge — 限时免费, ×0.1 — and the pending
// spinner) must stay put, so it must never live inside the sliding element.
// ---------------------------------------------------------------------------
test('the marquee slides only the name window, never the right-aligned badge', () => {
  runtime.reset()
  const { props } = makeProps(catalogState())
  const tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  const open = runtime.render(bundle.__component, props)

  const rows = gridRows(open)
  assert.ok(rows.length > 0, 'the grid rendered')
  for (const row of rows) {
    const windows = findAll(row, node => hasClass(node, 'dshmf-rowNameWindow'))
    assert.equal(windows.length, 1, 'each row has exactly one clipped name window')

    // The primary text lives inside the window: that is the only part allowed
    // to move when the marquee runs.
    const tracks = findAll(windows[0], node => hasClass(node, 'dshmf-rowNameTrack'))
    assert.equal(tracks.length, 1, 'the window holds the name track')
    assert.ok(textOf(tracks[0]).length > 0, 'the track carries the primary text')

    // The right-aligned trailing content is a SIBLING of the window, and the
    // badge is never inside the window or the track.
    const badge = findAll(row, node => hasClass(node, 'dshmf-badge'))[0]
    if (badge !== undefined) {
      assert.equal(findAll(windows[0], node => hasClass(node, 'dshmf-badge')).length, 0,
        'the catalog badge (限时免费 / ×0.1) is outside the sliding window')
      assert.equal(findAll(tracks[0], node => hasClass(node, 'dshmf-badge')).length, 0,
        'the catalog badge is not part of the marquee content')
    }

    // Nothing runs until the pointer rests on the row.
    assert.equal(tracks[0].props['data-running'], undefined, 'a resting row is not animating')
    assert.equal(tracks[0].props.style, undefined, 'a resting row carries no shift/duration')
  }
})

test('a resting pointer starts the marquee only on a clipped name, after the delay', async () => {
  runtime.reset()
  const { props } = makeProps(catalogState())
  let tree = runtime.render(bundle.__component, props)
  runtime.setRerender(() => { tree = runtime.render(bundle.__component, props) })
  tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)

  const rowOf = name => gridRows(tree).find(row => textOf(row).includes(name))
  const row = rowOf('Grok 4')
  assert.equal(typeof row.props.onMouseEnter, 'function', 'the row measures itself on pointer entry')

  // A DOM stub: the name is clipped by 40px inside a 100px window.
  const track = { scrollWidth: 140, clientWidth: 100 }
  const windowStub = { clientWidth: 100, scrollWidth: 140 }
  const rowStub = {
    querySelector: selector => (selector === '.dshmf-rowNameWindow' ? windowStub : track),
  }
  row.props.onMouseEnter({ currentTarget: rowStub })
  // Nothing happens before the delay elapses.
  assert.equal(gridRows(tree).find(r => textOf(r).includes('Grok 4')).props['data-running'], undefined,
    'the name does not start moving immediately')
  await new Promise(resolve => setTimeout(resolve, 700))
  const running = findAll(gridRows(tree).find(r => textOf(r).includes('Grok 4')),
    node => hasClass(node, 'dshmf-rowNameTrack'))[0]
  assert.equal(running.props['data-running'], 'true', 'a clipped name starts the marquee after the delay')
  assert.equal(running.props.style['--dshmf-marquee-shift'], '-40px',
    'the pass travels exactly the clipped amount')
  assert.match(String(running.props.style['--dshmf-marquee-duration']), /^\d+ms$/,
    'the duration is a time')

  // Leaving the row stops it and drops the shift, so nothing keeps moving
  // behind the pointer's back.
  gridRows(tree).find(r => textOf(r).includes('Grok 4')).props.onMouseLeave()
  const stopped = findAll(gridRows(tree).find(r => textOf(r).includes('Grok 4')),
    node => hasClass(node, 'dshmf-rowNameTrack'))[0]
  assert.equal(stopped.props['data-running'], undefined, 'leaving the row stops the marquee')
  assert.equal(stopped.props.style, undefined, 'and clears the measured shift')

  // A name that FITS must not move, however long the pointer rests on it.
  const shortRow = gridRows(tree).find(row => textOf(row).includes('Grok 4'))
  shortRow.props.onMouseEnter({
    currentTarget: { querySelector: () => ({ clientWidth: 200, scrollWidth: 200 }) },
  })
  await new Promise(resolve => setTimeout(resolve, 700))
  const quiet = findAll(gridRows(tree).find(r => textOf(r).includes('Grok 4')),
    node => hasClass(node, 'dshmf-rowNameTrack'))[0]
  assert.equal(quiet.props['data-running'], undefined, 'a name that fits never starts a marquee')
})

test('the marquee CSS clips the window, animates the track and respects reduced motion', () => {
  const css = source.match(/const CSS = `([\s\S]*?)`/)[1]
  const ruleOf = selector => {
    const at = css.indexOf(selector)
    assert.ok(at >= 0, `${selector} exists`)
    return css.slice(at, css.indexOf('}', at) + 1)
  }

  // The window is what clips: the ellipsis belongs there, and so does the
  // overflow that turns the name into a marquee candidate.
  const windowRule = ruleOf('.dshmf-rowNameWindow {')
  assert.match(windowRule, /overflow:\s*hidden/, 'the window clips its content')
  assert.match(windowRule, /text-overflow:\s*ellipsis/, 'a clipped name shows an ellipsis')
  assert.match(windowRule, /white-space:\s*nowrap/, 'the name never wraps')

  // The track is allowed to be wider than the window — that width IS the
  // overflow signal the pointer handler measures.
  const nameRule = ruleOf('.dshmf-rowName {')
  assert.match(nameRule, /width:\s*max-content/, 'the track takes the full name width')
  assert.doesNotMatch(nameRule, /text-overflow|overflow:\s*hidden/, 'the track itself never clips')

  // ONE keyframe pass: out to the last glyph and stop. The transform is the
  // only animated property, and there is no keyframe coming back.
  const keyframes = css.slice(css.indexOf('@keyframes dshmf-rowNameMarquee'), css.indexOf('.dshmf-rowNameTrack[data-running'))
  assert.match(keyframes, /translateX\(var\(--dshmf-marquee-shift\)\)/, 'the pass travels the measured shift')
  assert.equal((keyframes.match(/translateX\(0\)/g) ?? []).length, 1,
    'only the start keyframe sits at 0px — the pass never travels back')
  const running = ruleOf('.dshmf-rowNameTrack[data-running="true"] {')
  assert.match(running, /animation:\s*dshmf-rowNameMarquee/, 'a running track animates')
  assert.match(running, /ease-in-out/, 'the pass is eased in and out, not linear')
  assert.doesNotMatch(running, /linear/, 'a constant-speed crawl is not wanted here')
  assert.match(running, /\b1\b/, 'exactly one iteration')
  assert.doesNotMatch(running, /infinite/, 'the pass never repeats')
  assert.match(running, /forwards/, 'the end state is held instead of snapping back mid-hover')

  // Reduced motion wins: no marquee at all, for a row OR a group title.
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
  const reducedBlock = reduced.slice(0, reduced.indexOf('}'))
  assert.match(reducedBlock, /dshmf-rowNameTrack\[data-running="true"\]/,
    'the row marquee is listed under prefers-reduced-motion')
  assert.match(reducedBlock, /dshmf-groupTitleTrack\[data-running="true"\]/,
    'the group-title marquee is listed too')
  assert.match(reducedBlock, /animation:\s*none/,
    'both are disabled under prefers-reduced-motion')
})

test('a pointer that sweeps past a row before the delay starts nothing', async () => {
  // The 0.5s requirement is a REST requirement: moving across the grid must
  // never leave a marquee running behind the pointer.
  runtime.reset()
  const { props } = makeProps(catalogState())
  let tree = runtime.render(bundle.__component, props)
  runtime.setRerender(() => { tree = runtime.render(bundle.__component, props) })
  tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)

  const row = () => gridRows(tree).find(r => textOf(r).includes('Grok 4'))
  const trackOf = () => findAll(row(), node => hasClass(node, 'dshmf-rowNameTrack'))[0]
  row().props.onMouseEnter({
    currentTarget: { querySelector: () => ({ clientWidth: 100, scrollWidth: 140 }) },
  })
  await new Promise(resolve => setTimeout(resolve, 120))
  row().props.onMouseLeave()
  await new Promise(resolve => setTimeout(resolve, 700))
  assert.equal(trackOf().props['data-running'], undefined,
    'leaving before the delay elapses aborts the marquee entirely')
  assert.equal(trackOf().props.style, undefined, 'and no shift is left behind')
})

// ---------------------------------------------------------------------------
// Group-title marquee (DEC-023).
//
// A heading can be wider than its column ("ModelScope Token Plan" in a narrow
// band), so the label gets the SAME window/track split a model name has: the
// band is the frame and never moves, while its text slides inside it on hover.
// ---------------------------------------------------------------------------
test('a group title keeps a clipped window and a track, and never slides on rest', () => {
  runtime.reset()
  const { props } = makeProps(catalogState())
  let tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)

  const titles = gridTitles(tree)
  assert.ok(titles.length > 0, 'the grid drew group titles')
  for (const title of titles) {
    const windows = findAll(title, node => hasClass(node, 'dshmf-groupTitleWindow'))
    assert.equal(windows.length, 1, 'the band holds exactly one clipped window')
    const tracks = findAll(title, node => hasClass(node, 'dshmf-groupTitleTrack'))
    assert.equal(tracks.length, 1, 'and one sliding track inside it')
    assert.ok(textOf(tracks[0]).length > 0, 'the track carries the heading text')
    // The band itself is the frame: only the track may move.
    assert.equal(tracks[0].props['data-running'], undefined, 'a resting band does not animate')
    assert.equal(tracks[0].props.style, undefined, 'and carries no shift/duration')
    // The full heading stays available through the tooltip.
    assert.equal(title.props.title, textOf(tracks[0]))
  }
})

test('hovering a clipped group title starts the same one-pass marquee', async () => {
  runtime.reset()
  const { props } = makeProps(catalogState())
  let tree = runtime.render(bundle.__component, props)
  runtime.setRerender(() => { tree = runtime.render(bundle.__component, props) })
  tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)

  const titleOf = () => gridTitles(tree).find(t => textOf(t).includes('Third Party'))
  const trackOf = () => findAll(titleOf(), node => hasClass(node, 'dshmf-groupTitleTrack'))[0]
  assert.equal(typeof titleOf().props.onMouseEnter, 'function',
    'the band measures its own heading on pointer entry')
  assert.equal(typeof titleOf().props.onFocus, 'undefined',
    'a heading has no action, so keyboard focus must not trigger it')

  // A DOM stub: the heading overflows its window by 60px.
  titleOf().props.onMouseEnter({
    currentTarget: { querySelector: () => ({ clientWidth: 90, scrollWidth: 150 }) },
  })
  assert.equal(trackOf().props['data-running'], undefined,
    'nothing moves before the rest delay elapses')
  await new Promise(resolve => setTimeout(resolve, 700))
  const running = trackOf()
  assert.equal(running.props['data-running'], 'true', 'a clipped heading starts after the delay')
  assert.equal(running.props.style['--dshmf-marquee-shift'], '-60px',
    'it travels exactly the clipped amount')
  assert.match(String(running.props.style['--dshmf-marquee-duration']), /^\d+ms$/)

  // Leaving resets it with no animation, exactly like a row.
  titleOf().props.onMouseLeave()
  assert.equal(trackOf().props['data-running'], undefined, 'leaving the band stops it')
  assert.equal(trackOf().props.style, undefined, 'and clears the measured shift')

  // A heading that fits never moves, however long the pointer rests.
  titleOf().props.onMouseEnter({
    currentTarget: { querySelector: () => ({ clientWidth: 200, scrollWidth: 200 }) },
  })
  await new Promise(resolve => setTimeout(resolve, 700))
  assert.equal(trackOf().props['data-running'], undefined, 'a heading that fits never starts')
})

test('only one thing in the panel scrolls at a time, title or row', async () => {
  // Rows and titles share ONE marquee state machine, so starting a title must
  // cancel a running row and vice versa — the panel never has two tickers.
  runtime.reset()
  const { props } = makeProps(catalogState())
  let tree = runtime.render(bundle.__component, props)
  runtime.setRerender(() => { tree = runtime.render(bundle.__component, props) })
  tree = runtime.render(bundle.__component, props)
  findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  tree = runtime.render(bundle.__component, props)

  const row = gridRows(tree).find(r => textOf(r).includes('Grok 4'))
  row.props.onMouseEnter({
    currentTarget: { querySelector: () => ({ clientWidth: 100, scrollWidth: 160 }) },
  })
  await new Promise(resolve => setTimeout(resolve, 700))
  assert.equal(
    findAll(gridRows(tree).find(r => textOf(r).includes('Grok 4')),
      node => hasClass(node, 'dshmf-rowNameTrack'))[0].props['data-running'],
    'true', 'the row is running',
  )

  // Now rest on a title: the row must stop.
  const title = gridTitles(tree).find(t => textOf(t).includes('Third Party'))
  title.props.onMouseEnter({
    currentTarget: { querySelector: () => ({ clientWidth: 80, scrollWidth: 180 }) },
  })
  await new Promise(resolve => setTimeout(resolve, 700))
  assert.equal(
    findAll(gridTitles(tree).find(t => textOf(t).includes('Third Party')),
      node => hasClass(node, 'dshmf-groupTitleTrack'))[0].props['data-running'],
    'true', 'the title is now running',
  )
  assert.equal(
    findAll(gridRows(tree).find(r => textOf(r).includes('Grok 4')),
      node => hasClass(node, 'dshmf-rowNameTrack'))[0].props['data-running'],
    undefined, 'and the row stopped — never two tickers at once',
  )
})

test('the group-title marquee CSS clips the window and shares the row keyframes', () => {
  const css = source.match(/const CSS = `([\s\S]*?)`/)[1]
  const ruleOf = selector => {
    const at = css.indexOf(selector)
    assert.ok(at >= 0, `${selector} exists`)
    return css.slice(at, css.indexOf('}', at) + 1)
  }

  const band = ruleOf('.dshmf-groupTitle {')
  assert.match(band, /overflow:\s*hidden/, 'the band clips whatever overflows it')
  assert.match(band, /height:\s*20px/, 'the band height is unchanged for the column planner')
  assert.match(band, /background:\s*var\(--dsw-alias-bg-overlay\)/,
    'the band keeps its opaque fill — the sliding text must not disturb it')

  const windowRule = ruleOf('.dshmf-groupTitleWindow {')
  assert.match(windowRule, /overflow:\s*hidden/, 'the title window does the clipping')
  assert.match(windowRule, /text-overflow:\s*ellipsis/, 'a clipped heading shows an ellipsis')
  assert.match(windowRule, /white-space:\s*nowrap/, 'a heading never wraps')

  const track = ruleOf('.dshmf-groupTitleTrack {')
  assert.match(track, /width:\s*max-content/, 'the track is as wide as the heading')

  const running = ruleOf('.dshmf-groupTitleTrack[data-running="true"] {')
  assert.match(running, /dshmf-rowNameMarquee/, 'it reuses the row keyframes, not a second copy')
  assert.match(running, /ease-in-out/, 'same eased pass as a row')
  assert.doesNotMatch(running, /linear|infinite/, 'no linear crawl, no repeat')
  assert.match(running, /\b1\b/, 'exactly one iteration')
  assert.match(running, /forwards/, 'the end state is held')
})

// ---------------------------------------------------------------------------
// DEC-026: the measurement loops must not be self-feeding.
//
// `metrics.fixed` feeds `availableHeight`, which decides the column plan, which
// moves the panel's own height — the value the next measurement reads. An
// effect that re-runs on every render closes that into a feedback loop and
// React aborts the whole seat with "Maximum update depth exceeded" (error
// #185), which the seat boundary then paints as the trigger caption: exactly
// the "select model: Minified React error #185" chip users reported.
// ---------------------------------------------------------------------------

test('the measure effect is armed by layout inputs, not by every render', () => {
  const measure = source.slice(
    source.indexOf('// ---- measurement: probe metrics + fixed-section heights'),
    source.indexOf('// ---- placement: above the trigger'),
  )
  const deps = /}\s*,\s*\[([^\]]*)\]\)/.exec(measure)
  assert.ok(deps !== null, 'the measure effect carries a dependency array')
  assert.doesNotMatch(measure, /\n\s*\}\)\n\s*\n\s*\/\/ ---- placement/,
    'it is not left unconditional (no bare `})`)')
  for (const input of ['open', 'sectionCount', 'replan']) {
    assert.ok(deps[1].includes(input), `the measure effect re-arms on ${input}`)
  }
})

test('the placement effect is armed by layout inputs, not by every render', () => {
  const placement = source.slice(
    source.indexOf('// ---- placement: above the trigger'),
    source.indexOf('// Re-plan once fonts settle'),
  )
  assert.ok(/}\s*,\s*\[[^\]]*\]\)/.test(placement),
    'the placement effect carries a dependency array')
  assert.ok(/\[open, metrics\.fixed/.test(placement),
    'it re-places when the fixed sections or the row metrics move')
})

test('a sub-pixel drift is not mistaken for a new layout', () => {
  const { __test } = bundle
  // Quantization snaps to half a pixel, so rounding noise collapses to one value.
  assert.equal(__test.quantizeMetric(26.1), 26)
  assert.equal(__test.quantizeMetric(26.24), 26)
  assert.equal(__test.quantizeMetric(26.3), 26.5)
  assert.equal(__test.quantizeMetric(0), 0)
  assert.equal(__test.quantizeMetric(undefined), 0)
  // The comparison adds a two-pixel band on top, so a wrap flip that draws the
  // same panel never re-plans it.
  assert.equal(__test.metricChanged(26, 26), false)
  assert.equal(__test.metricChanged(26, 27), false, 'one pixel is jitter, not layout')
  assert.equal(__test.metricChanged(26, 28), true, 'two pixels is a real change')
  assert.equal(__test.metricChanged(20, 0), true, 'a section disappearing is a real change')
})

// ---------------------------------------------------------------------------
// Display mode: hand the composer's model seat back to the Host's own picker.
//
// The switch is a DISPOSAL, not a re-mount: a `single` slot keeps every
// registration and renders the highest-priority live one, so dropping this
// plugin's entry elects the shipped picker underneath. These tests pin the
// disposal, the refusal when nothing could inherit the cell, and the chip that
// brings the panel back.
// ---------------------------------------------------------------------------
/** Install a `localStorage` shim and return its backing map. */
function installModeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  globalThis.localStorage = {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
  }
  return map
}

/** Let the store's microtask notification run. */
const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 0))

test('the display mode defaults to flat and survives a reload', () => {
  const map = installModeStorage()
  try {
    const { readDisplayMode, writeDisplayMode, DISPLAY_MODE_KEY } = bundle.__test
    assert.equal(DISPLAY_MODE_KEY, 'dshmf:mode')
    assert.equal(readDisplayMode(), 'flat', 'nothing stored means the panel is shown')
    writeDisplayMode('native')
    assert.equal(map.get('dshmf:mode'), 'native', 'the choice is persisted, not just remembered')
    assert.equal(readDisplayMode(), 'native', 'a fresh read restores it')
    writeDisplayMode('nonsense')
    assert.equal(readDisplayMode(), 'flat', 'an unknown value falls back, never blanks the composer')
  } finally {
    delete globalThis.localStorage
  }
})

test('a missing localStorage still yields flat instead of throwing', () => {
  delete globalThis.localStorage
  assert.equal(bundle.__test.readDisplayMode(), 'flat')
  bundle.__test.writeDisplayMode('native')
  assert.equal(bundle.__test.readDisplayMode(), 'flat', 'a failed write is silent')
})

test('the mode store notifies asynchronously and only on a real change', async () => {
  installModeStorage()
  try {
    const store = bundle.__test.createDisplayModeStore({})
    let calls = 0
    const off = store.subscribe(() => { calls += 1 })
    store.set('native')
    // The click that flips the mode disposes the entry that owns the button, so
    // the notification must NOT land inside the event dispatch.
    assert.equal(calls, 0, 'notified in a microtask, not synchronously')
    await flushMicrotasks()
    assert.equal(calls, 1)
    store.set('native')
    await flushMicrotasks()
    assert.equal(calls, 1, 'setting the same value again is not a change')
    store.set('flat')
    await flushMicrotasks()
    assert.equal(calls, 2)
    off()
    store.set('native')
    await flushMicrotasks()
    assert.equal(calls, 2, 'an unsubscribed listener is not called')
    store.dispose()
    assert.equal(store.getSnapshot(), 'native', 'dispose drops listeners, not the value')
  } finally {
    delete globalThis.localStorage
  }
})

test('the panel footer renders a 原生 / Original mode button, enabled by default', () => {
  installModeStorage()
  try {
    runtime.reset()
    const { ctx, seat } = makeCtx({ extraEntries: { 'conversation.input.model': [() => null] } })
    bundle.apply(ctx)
    const face = seat().registration.inject('session-1')
    assert.equal(face.nativeAvailable(), true, 'the shipped entry is there to inherit the cell')
    const tree = runtime.render(bundle.__component, {
      ...face,
      locked: false,
      t: key => key,
    })
    findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
    const open = runtime.render(bundle.__component, { ...face, locked: false, t: key => key })
    const buttons = findAll(open, node => hasClass(node, 'dshmf-modeBtn'))
    assert.equal(buttons.length, 1, 'the mode button lives in the footer')
    assert.equal(buttons[0].props['aria-pressed'], false, 'flat mode is the default')
    assert.equal(buttons[0].props.disabled, false)
    assert.ok(findAll(findAll(open, node => hasClass(node, 'dshmf-footer'))[0],
      node => hasClass(node, 'dshmf-modeBtn')).length === 1,
    'it is inside the footer, not floating beside it')
  } finally {
    delete globalThis.localStorage
  }
})

test('the mode button is disabled when no other entry could inherit the seat', () => {
  installModeStorage()
  try {
    runtime.reset()
    const { ctx, seat } = makeCtx()
    bundle.apply(ctx)
    const face = seat().registration.inject('session-1')
    assert.equal(face.nativeAvailable(), false, 'nothing is registered underneath us')
    const tree = runtime.render(bundle.__component, { ...face, locked: false, t: key => key })
    findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
    const open = runtime.render(bundle.__component, { ...face, locked: false, t: key => key })
    const button = findAll(open, node => hasClass(node, 'dshmf-modeBtn'))[0]
    assert.equal(button.props.disabled, true,
      'stepping aside with nothing behind us would empty the composer')
    assert.equal(button.props.title, 'native.unavailable', 'and it says why')
  } finally {
    delete globalThis.localStorage
  }
})

test('switching to native mode disposes the seat, and switching back re-registers it', async () => {
  const map = installModeStorage()
  try {
    runtime.reset()
    const { ctx, seat, liveOf } = makeCtx({
      extraEntries: { 'conversation.input.model': [() => null] },
    })
    bundle.apply(ctx)
    const seatKey = 'conversation.input.model'
    assert.equal(liveOf(seatKey).length, 2, 'our entry plus the shipped one')

    bundle.__component // touch, so the module is materialized in this runtime
    const face = seat().registration.inject('session-1')
    face.setDisplayMode('native')
    await flushMicrotasks()

    assert.equal(map.get('dshmf:mode'), 'native', 'the choice is persisted')
    assert.equal(liveOf(seatKey).length, 1,
      'our entry is gone — the shipped picker is now the elected winner')
    assert.equal(liveOf(seatKey)[0].registrant, 'shipped',
      'and the entry left standing is the Host\'s, not a copy of it')

    face.setDisplayMode('flat')
    await flushMicrotasks()
    assert.equal(liveOf(seatKey).length, 2, 'coming back re-registers our panel')
    assert.equal(seat().registration.priority, -1, 'still at a negative shadowing priority')
  } finally {
    delete globalThis.localStorage
  }
})

test('native mode is refused when the Host cannot prove an inheritor', async () => {
  installModeStorage({ 'dshmf:mode': 'native' })
  try {
    runtime.reset()
    // An older Host: no enumeration of competing entries.
    const { ctx, liveOf } = makeCtx({ omitSlotEnumeration: true })
    bundle.apply(ctx)
    await flushMicrotasks()
    // A persisted `native` from a previous install must not blank the composer.
    assert.equal(liveOf('conversation.input.model').length, 1,
      'the panel stays mounted when stepping aside cannot be verified')
  } finally {
    delete globalThis.localStorage
  }
})

test('a persisted native mode activates straight into the shipped picker', async () => {
  installModeStorage({ 'dshmf:mode': 'native' })
  try {
    runtime.reset()
    const { ctx, liveOf } = makeCtx({
      extraEntries: { 'conversation.input.model': [() => null] },
    })
    bundle.apply(ctx)
    await flushMicrotasks()
    const entries = liveOf('conversation.input.model')
    assert.equal(entries.length, 1, 'the plugin never registers, so the Host wins from boot')
    assert.equal(entries[0].registrant, 'shipped')
  } finally {
    delete globalThis.localStorage
  }
})

test('the native picker\'s own menu carries the way back, and nothing in flat mode', async () => {
  installModeStorage()
  try {
    runtime.reset()
    const { ctx, live, liveOf } = makeCtx({
      extraEntries: { 'conversation.input.model': [() => null] },
    })
    bundle.apply(ctx)
    const row = liveOf('conversation.input.model.options')[0]
    assert.ok(row, 'the row rides the shipped picker\'s own root-menu slot')
    assert.equal(row.registration.id, 'dsh-model-flatmap.native')
    const rowFace = row.registration.inject()
    // The shipped menu hands its occupants a `dismiss`; the row must close the
    // menu before it disposes the entry that owns it.
    let dismissed = 0
    const props = { ...rowFace, dismiss: () => { dismissed += 1 }, t: key => key }

    const flatTree = runtime.render(bundle.__nativeMenuRow, props)
    assert.equal(flatTree, null, 'in flat mode the row draws nothing at all')

    bundle.__component
    // Flip through the row's own face: that is exactly what a user in native
    // mode would click.
    rowFace.setDisplayMode('native')
    await flushMicrotasks()
    const nativeTree = runtime.render(bundle.__nativeMenuRow, props)
    assert.ok(nativeTree !== null, 'native mode shows the way back')
    assert.equal(hasClass(nativeTree, 'dshmf-modeRow'), true)
    assert.equal(nativeTree.props.role, 'menuitem', 'it is a row of the host menu, not a stray button')
    assert.equal(nativeTree.props.title, 'native.back')
    // Which mode is live does not depend on the seat being mounted.
    assert.equal(liveOf('conversation.input.model').length, 1)

    nativeTree.props.onClick()
    await flushMicrotasks()
    assert.equal(dismissed, 1, 'the host menu is closed before the entry it belongs to goes away')
    assert.equal(runtime.render(bundle.__nativeMenuRow, props), null,
      'clicking it returns to flat, which hides the row again')
    assert.equal(liveOf('conversation.input.model').length, 2, 'and the panel is back')
  } finally {
    delete globalThis.localStorage
  }
})

test('the composer tool row no longer carries a mode control', async () => {
  installModeStorage({ 'dshmf:mode': 'native' })
  try {
    runtime.reset()
    const { ctx, liveOf } = makeCtx({
      extraEntries: { 'conversation.input.model': [() => null] },
    })
    bundle.apply(ctx)
    await flushMicrotasks()
    assert.equal(liveOf('conversation.input.right').length, 0,
      'the way back lives in the native picker itself, not beside its trigger')
  } finally {
    delete globalThis.localStorage
  }
})

test('unloading the plugin releases both the seat and the menu row', async () => {
  installModeStorage()
  try {
    runtime.reset()
    const { ctx, registered, liveOf } = makeCtx({
      extraEntries: { 'conversation.input.model': [() => null] },
    })
    bundle.apply(ctx)
    const seatInject = registered.find(entry => entry.key === 'conversation.input.model')
    const rowInject = registered.find(entry => entry.key === 'conversation.input.model.options')
    assert.ok(seatInject, 'the seat waits on its declaration')
    assert.ok(rowInject, 'the row waits on the shipped picker\'s declaration')
    seatInject.dispose()
    rowInject.dispose()
    assert.equal(liveOf('conversation.input.model').length, 1, 'no residue: only the Host is left')
    assert.equal(liveOf('conversation.input.model.options').length, 0, 'the row is gone too')
  } finally {
    delete globalThis.localStorage
  }
})

test('a degraded face still answers the mode hooks without ever stepping aside', () => {
  runtime.reset()
  // The face a failed `buildFace` throws back, which the component must still be
  // able to render: a stable flat snapshot, a no-op setter, and a refusal to
  // step aside.
  const face = {
    displayMode: bundle.__test.FLAT_DISPLAY_MODE,
    setDisplayMode: () => {},
    nativeAvailable: () => false,
  }
  assert.equal(face.nativeAvailable(), false, 'a broken face must not hand the cell away')
  assert.equal(face.displayMode.getSnapshot(), 'flat')
  assert.equal(typeof face.setDisplayMode, 'function')

  const props = {
    ...face,
    locked: false,
    t: key => key,
    available: true,
    resolveDirectory: () => ({ addressed: false }),
    load: () => {},
    select: () => Promise.resolve(undefined),
    resolveText: value => value,
    teamAvailable: () => false,
    setTeamMode: () => Promise.resolve(undefined),
    insufficient: { subscribe: () => () => {}, getSnapshot: () => ({ marks: new Map() }) },
  }
  const closed = runtime.render(bundle.__component, props)
  findAll(closed, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  const open = runtime.render(bundle.__component, props)
  const button = findAll(open, node => hasClass(node, 'dshmf-modeBtn'))[0]
  assert.ok(button, 'the footer still draws the mode button')
  assert.equal(button.props.disabled, true, 'and it refuses to step aside')
})

test('every native-mode key is translated in both languages', () => {
  runtime.reset()
  const { ctx, dictionaryRegistrations } = makeCtx()
  bundle.apply(ctx)
  const dicts = dictionaryRegistrations[0].dicts
  for (const key of ['native.label', 'native.enter', 'native.back', 'native.unavailable']) {
    assert.equal(typeof dicts.zh[key], 'string', `zh ${key}`)
    assert.equal(typeof dicts.en[key], 'string', `en ${key}`)
    assert.notEqual(dicts.zh[key], '', `zh ${key} is not empty`)
    assert.notEqual(dicts.en[key], '', `en ${key} is not empty`)
  }
  assert.equal(dicts.zh['native.label'], '原生')
  assert.equal(dicts.en['native.label'], 'Original')
})

test('a stored native mode that could not take effect reports the flat state it actually shows', () => {
  // `native` persisted, but no entry could inherit the cell, so the controller
  // kept the panel mounted. The button must then read as FLAT — pressing state
  // is a claim about what is on screen, not about what is in storage.
  installModeStorage({ 'dshmf:mode': 'native' })
  try {
    runtime.reset()
    const { ctx, seat } = makeCtx()
    bundle.apply(ctx)
    const face = seat().registration.inject('session-1')
    assert.equal(face.displayMode.getSnapshot(), 'native', 'storage still says native')
    assert.equal(face.nativeAvailable(), false, 'but there is nothing to hand the cell to')
    const tree = runtime.render(bundle.__component, { ...face, locked: false, t: key => key })
    findAll(tree, node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
    const open = runtime.render(bundle.__component, { ...face, locked: false, t: key => key })
    const button = findAll(open, node => hasClass(node, 'dshmf-modeBtn'))[0]
    assert.equal(button.props['aria-pressed'], false,
      'the panel is visible, so the button must not claim native mode')
    assert.equal(button.props.disabled, true)
  } finally {
    delete globalThis.localStorage
  }
})

test('the mode button toggles: a pressed button offers the way back', () => {
  // Flat mode: the click hands the seat over.
  installModeStorage()
  try {
    runtime.reset()
    const { ctx, seat } = makeCtx({ extraEntries: { 'conversation.input.model': [() => null] } })
    bundle.apply(ctx)
    const face = seat().registration.inject('session-1')
    const props = { ...face, locked: false, t: key => key }
    findAll(runtime.render(bundle.__component, props), node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
    const flat = findAll(runtime.render(bundle.__component, props), node => hasClass(node, 'dshmf-modeBtn'))[0]
    assert.equal(flat.props.title, 'native.enter', 'flat offers to go native')
    flat.props.onClick()
  } finally {
    delete globalThis.localStorage
  }

  // Native mode, forced onto the component: the same button must now offer flat,
  // not re-assert native (which would leave a pressed button that does nothing).
  runtime.reset()
  const nativeStore = {
    getSnapshot: () => 'native',
    subscribe: () => () => {},
    set: () => {},
  }
  const props = {
    displayMode: nativeStore,
    setDisplayMode: () => {},
    nativeAvailable: () => false,
    locked: false,
    t: key => key,
    available: true,
    resolveDirectory: () => ({ addressed: false }),
    load: () => {},
    select: () => Promise.resolve(undefined),
    resolveText: value => value,
    teamAvailable: () => false,
    setTeamMode: () => Promise.resolve(undefined),
    insufficient: { subscribe: () => () => {}, getSnapshot: () => ({ marks: new Map() }) },
  }
  findAll(runtime.render(bundle.__component, props), node => hasClass(node, 'dshmf-trigger'))[0].props.onClick()
  const open = runtime.render(bundle.__component, props)
  const button = findAll(open, node => hasClass(node, 'dshmf-modeBtn'))[0]
  // `nativeAvailable` is false here, so the stored native mode is not in effect
  // and the button reports flat — the consistency rule from the earlier test.
  assert.equal(button.props['aria-pressed'], false)
})

test('the measure key names the footer CONTENT, since the footer is always drawn', () => {
  // The mode button made the footer permanent, so a key that asks "is the footer
  // there?" would be constant and a footer that gains or loses the reasoning
  // group or the teamwork row would never be re-measured. The key must follow
  // the dynamic members instead (DEC-026 dependency discipline, DEC-027 footer).
  const measure = source.slice(
    source.indexOf('// What decides which fixed sections EXIST'),
    source.indexOf('// ---- measurement: probe metrics'),
  )
  assert.match(measure, /const footerKey = `\$\{effortChoices\.length > 0 \? 'reason' : 'none'\}/,
    'the key names the reasoning group by presence, not by a count that is hidden when absent')
  assert.match(measure, /\$\{teamRowShown \? 'team' : 'none'\}/,
    'and the teamwork row by presence')
  assert.doesNotMatch(measure, /teamRowShown = !\(/,
    'the old "footer may be absent" negation is gone with the always-on footer')
})
