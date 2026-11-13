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
const { familyOf, familyRank, familyVariant, idVariantOf, matchScore, providerScore, searchTokens, buildUnits, columnHeight, planColumns, packColumns } = bundle.__test

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

test('a registered brand keeps its generations distinct', () => {
  // The old merge (DEC-004) put hy3 and hy4 in ONE HY family. That was a
  // mistake: the generation has to be visible. hy3 → HY3, hy4* → HY4,
  // and a bare hy → HY (no generation digit to keep).
  assert.equal(familyOf({ id: 'hy3', name: 'Hy3' }), 'HY3')
  assert.equal(familyOf({ id: 'hy3-x', name: 'Hy3' }), 'HY3')
  assert.equal(familyOf({ id: 'hy4-preview', name: 'Hy4' }), 'HY4')
  assert.equal(familyOf({ id: 'hy4free', name: 'Hy4' }), 'HY4')
  assert.equal(familyOf({ id: 'hy4std', name: 'Hy4' }), 'HY4')
  assert.equal(familyOf({ id: 'hy4flash-exp1', name: 'Hy4' }), 'HY4')
  assert.equal(familyOf({ id: 'hy', name: 'HY' }), 'HY')
  // A provider prefix on the id does not hide the brand or its generation.
  assert.equal(familyOf({ id: 'codebuddy-hy3', name: 'Hy3' }), 'HY3')
  assert.equal(familyOf({ id: 'codebuddy-cli:hy4-preview', name: 'Hy4' }), 'HY4')
  // Dictionary families are never split by generation.
  assert.equal(familyOf({ id: 'gpt-5.5', name: 'GPT 5.5' }), 'GPT')
})

test('generations rank with their brand, in generation order', () => {
  const hy = familyRank('HY')
  assert.ok(familyRank('HY3') > hy, 'HY3 ranks after the bare brand')
  assert.ok(familyRank('HY4') > familyRank('HY3'), 'HY4 ranks after HY3')
  assert.ok(familyRank('HY4') < familyRank('Others'), 'still before Others')
})

test('unregistered brands still collapse their version tail', () => {
  // The generation split applies only to registered brands. Other brands keep
  // the DEC-004 behaviour: a version tail never splits one heading.
  assert.equal(familyOf({ id: 'acme4-turbo', name: 'Acme 4 Turbo' }), 'Acme')
  assert.equal(familyOf({ id: 'acme-7b', name: 'Acme 7B' }), 'Acme')
})

test('family row variant is short and omits the family name', () => {
  // Row content is provider-primary; the secondary text is only a variant.
  assert.equal(idVariantOf({ id: 'hy4free' }, 'HY4'), 'free')
  assert.equal(idVariantOf({ id: 'hy4std' }, 'HY4'), 'std')
  assert.equal(idVariantOf({ id: 'hy4-preview' }, 'HY4'), 'preview')
  assert.equal(idVariantOf({ id: 'hy4flash-exp1' }, 'HY4'), 'flash exp1')
  assert.equal(idVariantOf({ id: 'hy3-x' }, 'HY3'), 'x')
  assert.equal(idVariantOf({ id: 'hy4free' }, 'HY4').includes('hy'), false,
    'the family name never leaks into a row variant')
  assert.equal(familyVariant({ id: 'hy4free', name: 'Hy4' }, 'HY4'), 'free')
  assert.equal(familyVariant({ id: 'gpt-5.5', name: 'GPT 5.5 Turbo' }, 'GPT'), 'Turbo')
})

test('a bare version is not a brand', () => {
  // A version-only id names no brand, so it cannot become a heading of its own.
  assert.equal(familyOf({ id: 'v2', name: 'V2' }), 'Others')
  assert.equal(familyOf({ id: '2024', name: '2024' }), 'Others')
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

test('whitespace splits a query into tokens, and blanks are dropped', () => {
  assert.deepEqual(searchTokens('mod inte'), ['mod', 'inte'])
  assert.deepEqual(searchTokens('  MOD   inte  '), ['mod', 'inte'])
  assert.deepEqual(searchTokens(''), [])
  assert.deepEqual(searchTokens('   '), [])
  assert.deepEqual(searchTokens(undefined), [])
})

test('every token must land, so `mod inte` finds ModelScope International', () => {
  // The two words are never contiguous in the name; the old whole-string
  // substring test rejected it.
  assert.equal(matchScore('ModelScope International', 'mod inte'), 1)
  assert.equal(matchScore('ModelScope International', 'mod int'), 1)
  assert.equal(matchScore('ModelScope International', 'MOD INTE'), 1)
  // One missing token still rejects the whole name.
  assert.equal(matchScore('ModelScope International', 'mod zzz'), null)
  assert.equal(matchScore('ModelScope International', 'zzz inte'), null)
})

test('a multi-token hit ranks by its weakest token, never better than a prefix', () => {
  // `mod` starts the name (prefix rung), `inte` sits inside it (substring
  // rung); the weakest of the two wins, so the whole hit ranks as a substring.
  assert.equal(matchScore('ModelScope International', 'mod inte'), 1)
  assert.equal(matchScore('ModelScope International', 'modelscope'), 0)
  // Spelling the second word out does not promote it: it still sits inside the
  // name rather than starting it, so the rank stays on the substring rung.
  assert.equal(matchScore('ModelScope International', 'modelscope international'), 1)
  // A token only reachable as a subsequence drags the whole match to that rung.
  assert.equal(matchScore('ModelScope International', 'msc inte'), 2)
})

test('a single-token query keeps the original ranking exactly', () => {
  // Guards the change: whitespace splitting must not disturb one-term search.
  assert.equal(matchScore('DeepSeek Chat', 'deep'), 0)
  assert.equal(matchScore('DeepSeek Chat', 'chat'), 1)
  assert.equal(matchScore('DeepSeek Chat', 'dsc'), 2)
  assert.equal(matchScore('anything', '   '), 0)
  assert.equal(matchScore('anything', ''), 0)
})

test('a multi-token query matches a provider whose words are not contiguous', () => {
  const prov = { id: 'modelscope', name: { zh: '魔搭 ModelScope', en: 'ModelScope International' } }
  assert.equal(providerScore(prov, 'mod inte'), 1)
  assert.equal(providerScore(prov, 'MOD INTE'), 1)
  assert.equal(providerScore(prov, 'mod'), 0, 'the id still answers a prefix')
  assert.equal(providerScore(prov, 'mod zzz'), null)
  // Tokens may land in different faces: the id answers `mod`, the name `魔搭`.
  assert.equal(providerScore(prov, 'mod 魔搭'), 0)
  // The subsequence guard is per token and still holds.
  assert.equal(providerScore(prov, 'dbao'), null)
})

test('a provider matches on any face of its id, name, or drawn label', () => {
  const doubao = { id: 'doubao', name: { zh: '豆包', en: 'Doubao' } }
  // `dou` is a prefix of the id, so the provider answers even before its label.
  assert.equal(providerScore(doubao, 'dou'), 0)
  assert.equal(providerScore(doubao, 'DOU'), 0)
  // The catalog name is localized; the English face still matches.
  assert.equal(providerScore(doubao, 'doubao'), 0)
  // A substring hit inside the id ranks below a prefix hit.
  assert.equal(providerScore(doubao, 'ub'), 1)
  // The label the section draws is searched too, so the Chinese name works.
  assert.equal(providerScore({ id: 'doubao', name: 'Doubao' }, '豆', '豆包(doubao)'), 0)
  assert.equal(providerScore({ id: 'doubao', name: 'Doubao' }, 'bao'), 1)
  assert.equal(providerScore(doubao, 'zzz'), null)
  assert.equal(providerScore(doubao, '   '), null)
  assert.equal(providerScore(undefined, 'dou'), null)
})

test('a provider hit never fires on an ordered subsequence', () => {
  // `dbao` is a subsequence of `doubao` but neither a prefix nor a substring,
  // so it must not drag a whole provider into the grid.
  assert.equal(providerScore({ id: 'doubao', name: 'Doubao' }, 'dbao'), null)
  assert.equal(matchScore('Doubao Seed', 'dbao'), 2, 'model names still allow it')
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
  // `remote` / `remote.agentTeams` are declared so the guarded client context
  // authorises reading the Host's teamwork namespace; without them the
  // teamwork switch silently never renders. `sessions` is declared so the seat
  // can read the Session's durable event feed, which is where a model call's
  // insufficient-balance failure is recorded.
  assert.deepEqual(bundle.inject, ['slots', 'locale', 'remote', 'remote.agentTeams', 'sessions'])
})
