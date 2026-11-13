/**
 * Pure-function tests for the flat model picker: family resolution, search
 * ranking, and the column algorithm. These run in plain Node with a stub module
 * loader, so no browser is involved.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** Minimal class base so boundary wrappers can extend it. */
class StubComponent {
  constructor(props) { this.props = props; this.state = {} }
  setState(next) { this.state = { ...this.state, ...next } }
}

const STUB_REACT = {
  Component: StubComponent,
  createElement: () => null,
  useCallback: fn => fn,
  useEffect: () => {},
  useId: () => 'id',
  useLayoutEffect: () => {},
  useMemo: fn => fn(),
  useRef: value => ({ current: value }),
  useState: value => [value, () => {}],
  useSyncExternalStore: () => undefined,
}

/**
 * Evaluate the bundle source against the module-loader facade it registers
 * into, and materialize its factory with stub builtins.
 * @returns {object} the plugin object the bundle exports.
 */
function materialize() {
  let registration
  globalThis.window = { __ModuleLoader__: { load: value => { registration = value } } }
  try {
    // eslint-disable-next-line no-new-func
    new Function(source)()
  } finally {
    delete globalThis.window
  }
  assert.ok(registration, 'the bundle registers itself with the module loader')
  assert.equal(registration.id, 'dsh-model-flatmap')
  return registration.factory(specifier => {
    if (specifier === 'react') return STUB_REACT
    if (specifier === 'react-dom') return { createPortal: () => null }
    throw new Error(`unexpected require: ${specifier}`)
  })
}

const bundle = materialize()
const { familyOf, matchScore, buildUnits, columnHeight, planColumns, packColumns } = bundle.__test

test('families come from the dictionary before the id guess', () => {
  assert.equal(familyOf({ id: 'deepseek-chat', name: 'DeepSeek Chat' }), 'DeepSeek')
  assert.equal(familyOf({ id: 'claude-sonnet-4', name: 'Claude Sonnet 4' }), 'Sonnet')
  assert.equal(familyOf({ id: 'grok-4', name: 'Grok 4' }), 'Grok')
  assert.equal(familyOf({ id: 'glm-4.6', name: 'GLM 4.6' }), 'GLM')
  assert.equal(familyOf({ id: 'kimi-k2', name: 'Kimi K2' }), 'Kimi')
})

test('an uncovered model id falls back to its first id segment', () => {
  assert.equal(familyOf({ id: 'acme-7b', name: 'Acme 7B' }), 'Acme')
  assert.equal(familyOf({ id: 'vendor/acme-7b', name: 'Acme 7B' }), 'Acme')
})

test('an unjudgeable id lands in Others', () => {
  assert.equal(familyOf({ id: '2024', name: '2024' }), 'Others')
  assert.equal(familyOf({ id: 'v2', name: 'V2' }), 'Others')
  assert.equal(familyOf({ id: '', name: '' }), 'Others')
})

test('search ranks prefix above substring above subsequence, and rejects misses', () => {
  assert.equal(matchScore('DeepSeek Chat', 'deep'), 0)
  assert.equal(matchScore('DeepSeek Chat', 'chat'), 1)
  assert.equal(matchScore('DeepSeek Chat', 'dsc'), 2)
  assert.equal(matchScore('DeepSeek Chat', 'zzz'), null)
  assert.equal(matchScore('anything', '   '), 0)
})

const entry = (model, providerId) => ({ model, providerId })

test('a group title stays with its first model in one unit', () => {
  const sections = [
    { key: 'p1', title: 'P1', models: [entry({ id: 'a', name: 'A' }, 'p1'), entry({ id: 'b', name: 'B' }, 'p1')] },
  ]
  const units = buildUnits(sections, 26, 20)
  assert.equal(units.length, 2)
  assert.equal(units[0].blocks.length, 2)
  assert.equal(units[0].blocks[0].kind, 'title')
  assert.equal(units[0].blocks[1].kind, 'row')
  assert.equal(units[0].height, 20 + 2 + 26)
  assert.equal(units[1].height, 26)
  assert.equal(columnHeight(units), 48 + 2 + 26)
})

test('a short list converges to one column', () => {
  const sections = [{ key: 'p', title: 'P', models: [entry({ id: 'a', name: 'A' }, 'p')] }]
  const plan = planColumns(buildUnits(sections, 26, 20), 300)
  assert.equal(plan.count, 1)
})

test('a long list widens to at most three columns and never exceeds the cap', () => {
  const models = Array.from({ length: 40 }, (_, index) => entry({ id: `m${index}`, name: `M${index}` }, 'p'))
  const sections = [{ key: 'p', title: 'P', models }]
  const units = buildUnits(sections, 26, 20)
  for (const available of [200, 120, 60, 20]) {
    const plan = planColumns(units, available)
    assert.ok(plan.count >= 1 && plan.count <= 3)
    assert.equal(plan.columns.length, plan.count)
    const flat = plan.columns.flat()
    assert.equal(flat.length, units.length, 'every unit is placed exactly once')
  }
  // Tall enough for the whole list on one line: the planner stays at one column.
  const tall = planColumns(units, 4000)
  assert.equal(tall.count, 1)
  // Too short for even three columns: it stays at three and lets the grid scroll.
  const squeezed = planColumns(units, 10)
  assert.equal(squeezed.count, 3)
})

test('columns balance the trailing deficit without splitting a title from its model', () => {
  const models = Array.from({ length: 9 }, (_, index) => entry({ id: `m${index}`, name: `M${index}` }, 'p'))
  const sections = [{ key: 'p', title: 'P', models }]
  const units = buildUnits(sections, 26, 20)
  const columns = packColumns(units, 2)
  const heights = columns.map(columnHeight)
  assert.ok(Math.abs(heights[0] - heights[1]) < 40, `heights ${heights.join('/')} should be close`)
  for (const column of columns) {
    for (const unit of column) {
      if (unit.blocks[0].kind === 'title') assert.equal(unit.blocks[1].kind, 'row')
    }
  }
})

test('an empty catalog plans a single empty column', () => {
  const plan = planColumns([], 300)
  assert.equal(plan.count, 1)
  assert.deepEqual(plan.columns, [[]])
})

test('the bundle factory materializes with the plugin face', () => {
  assert.equal(typeof bundle.apply, 'function')
  assert.deepEqual(bundle.inject, ['slots', 'locale'])
})
