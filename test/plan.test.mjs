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
const { familyOf, familyRank, familyVariant, idVariantOf, matchScore, providerScore, searchTokens, buildUnits, columnHeight, planColumns, packColumns, marqueePassGeometry, MARQUEE_PX_PER_SECOND, MARQUEE_MIN_MS } = bundle.__test

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
  // Row content is provider-primary; the secondary text is the model-specific
  // tail. The family heading and the provider's own label are both stripped,
  // and version numbers are KEPT — they are the型号 the heading lacks.
  assert.equal(idVariantOf({ id: 'hy4free' }, 'HY4'), 'free')
  assert.equal(idVariantOf({ id: 'hy4std' }, 'HY4'), 'std')
  assert.equal(idVariantOf({ id: 'hy4-preview' }, 'HY4'), 'preview')
  assert.equal(idVariantOf({ id: 'hy4flash-exp1' }, 'HY4'), 'flash exp1')
  assert.equal(idVariantOf({ id: 'hy3-x' }, 'HY3'), 'x')
  assert.equal(idVariantOf({ id: 'hy4free' }, 'HY4').includes('hy'), false,
    'the family name never leaks into a row variant')
  // Falls back to the id tail when the NAME adds nothing beyond the family.
  assert.equal(familyVariant({ id: 'hy4free', name: 'Hy4' }, 'HY4'), 'free')
  assert.equal(familyVariant({ id: 'gpt-5.5', name: 'GPT 5.5 Turbo' }, 'GPT'), '5.5 Turbo',
    'the version is kept: the heading alone cannot tell two GPT models apart')
})

test('the family tail strips the family heading even when it is glued to the version', () => {
  // Real ids and names glue the brand to the version — `Qwen3.8-…`,
  // `Deepseek-V4.1-…`, `MiniMax-M3`. A whole-word match would miss all of them,
  // so the heading is removed as a SUBSTRING and the remaining型号 survives.
  assert.equal(familyVariant({ id: 'Qwen/Qwen3.8-Flash-Next', name: 'Qwen3.8-Flash-Next' }, 'Qwen'),
    '3.8-Flash-Next')
  assert.equal(familyVariant({ id: 'Qwen/Qwen3.8-27B', name: 'Qwen3.8-27B' }, 'Qwen'), '3.8-27B',
    'two models of one family are told apart by their型号')
  assert.equal(familyVariant({ id: 'deepseek-v4.1-flash', name: 'Deepseek-V4.1-Flash · x0.00' }, 'DeepSeek'),
    'V4.1-Flash · x0.00', 'the multiplier travels with the tail')
  assert.equal(familyVariant({ id: 'MiniMax/MiniMax-M3', name: 'MiniMax-M3' }, 'MiniMax'), 'M3')
  assert.equal(familyVariant({ id: 'ZhipuAI/GLM-5.2', name: 'GLM-5.2' }, 'GLM'), '5.2')
  // A mid-name heading is removed too, and never welds its neighbours together.
  assert.equal(familyVariant({ id: 'moonshotai/Kimi-K3.1-Pro', name: 'Kimi-K3.1-Pro' }, 'Kimi'), 'K3.1-Pro')
  assert.equal(familyVariant({ id: 'x', name: 'Fast Qwen Turbo' }, 'Qwen'), 'Fast Turbo')
})

test('the family tail drops the provider label the row already prints', () => {
  // The provider IS the row's primary text, so a tail repeating it would print
  // the same words twice. Removal is whole-word, so a short label can never
  // punch a hole in an unrelated word.
  assert.equal(familyVariant({ id: 'doubao-2.1-turbo', name: '豆包 2.1 Turbo' }, 'Doubao', '豆包(doubao)'),
    '2.1 Turbo')
  assert.equal(familyVariant({ id: 'a', name: 'AI Rain Model' }, 'Ace', 'AI'), 'Rain Model',
    'a two-letter provider label does not eat the inside of a word')
  assert.equal(familyVariant({ id: 'a', name: 'Acme Model' }, 'Ace', 'X'), 'Acme Model',
    'labels shorter than two characters are ignored')
})

test('a family tail that would say nothing at all is empty, not noise', () => {
  // Nothing beyond the heading: the row draws no tail (`HY4` under `HY4`).
  assert.equal(familyVariant({ id: 'hy4', name: 'Hy4' }, 'HY4'), '')
  assert.equal(familyVariant({ id: 'hy4', name: 'HY4' }, 'HY4'), '')
  // A name that is ONLY the provider label (plus the family) leaves nothing,
  // and the id carries nothing beyond the family either, so no tail is drawn.
  assert.equal(familyVariant({ id: 'hy4', name: '豆包' }, 'HY4', '豆包(doubao)'), '')
  // The id is the fallback only when it DOES add something (`auto` under a
  // family whose name says nothing): a row must stay distinguishable.
  assert.equal(familyVariant({ id: 'auto', name: '豆包' }, 'Doubao', '豆包(doubao)'), 'auto')
})

test('a dangling separator never survives at a tail edge', () => {
  // Removing the family from "Qwen · 2.0" leaves " · 2.0"; the leading "·" must
  // go, and so must any trailing punctuation.
  assert.equal(familyVariant({ id: 'qwen-2', name: 'Qwen · 2.0' }, 'Qwen'), '2.0')
  assert.equal(familyVariant({ id: 'qwen-2', name: 'Qwen 2.0.' }, 'Qwen'), '2.0')
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

// ---------------------------------------------------------------------------
// Model-name marquee geometry (DEC-021).
//
// The name row ellipsises when it cannot fit, and a pointer resting on it
// starts a slow marquee. The geometry is a pure function so the speed can be
// pinned: too fast reads as a glitch, too slow as a hang.
// ---------------------------------------------------------------------------
test('marquee geometry: one one-way pass at a fixed average speed', () => {
  assert.deepEqual(marqueePassGeometry(0), { shift: 0, duration: 0 }, 'a name that fits never moves')
  assert.deepEqual(marqueePassGeometry(-4), { shift: 0, duration: 0 }, 'a negative measurement is treated as "fits"')
  assert.deepEqual(marqueePassGeometry(Number.NaN), { shift: 0, duration: 0 }, 'NaN never animates')

  // ONE pass, no return leg: the duration is exactly the shift divided by the
  // pinned average velocity (ease-in-out is symmetric, so it softens the ends
  // around that average without changing it).
  const { shift, duration } = marqueePassGeometry(128)
  assert.equal(shift, 128, 'the name travels exactly as far as it is clipped')
  assert.equal(duration, Math.round((128 / MARQUEE_PX_PER_SECOND) * 1000),
    'the single pass lasts exactly shift / speed — there is no return trip to budget for')
  assert.equal(Math.round((shift / (duration / 1000)) * 10) / 10, MARQUEE_PX_PER_SECOND,
    'the average velocity is the pinned speed')

  // Short overflows are held back by the floor instead of whipping past.
  assert.equal(marqueePassGeometry(1).shift, 1)
  assert.ok(marqueePassGeometry(1).duration >= MARQUEE_MIN_MS, 'a 1px overflow still gets the minimum pass')

  // Longer names take longer, monotonically, and stay in a readable window.
  const long = marqueePassGeometry(400)
  assert.ok(long.duration > duration, 'a longer overflow takes longer')
  assert.ok(duration >= 2000 && duration <= 4000, 'a ~128px overflow passes in a calm 2-4s window')
})
