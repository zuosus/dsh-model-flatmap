/**
 * Tests for the plugin's own config file (`config.yaml`, `config.js`).
 *
 * Why this file exists at all: the visibility switches and provider renames used
 * to live only in the browser's `localStorage`, which means they were invisible,
 * un-diffable and un-backup-able — and a hand-edit was impossible. The user
 * asked for `$DSH_HOME/dsh-model-flatmap/config.yaml` to be the source of truth.
 *
 * The failure modes here all fail silently, which is why they get assertions:
 *
 *   - a config file that is silently ignored (the user edits it, nothing happens);
 *   - a malformed file that is silently coerced into "everything visible" (the
 *     user's carefully hidden models come back and they never learn why);
 *   - a write that truncates the file before it succeeds (the user loses config
 *     to a full disk);
 *   - a round-trip that loses a key (a rename quietly disappears).
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CONFIG_FILE_NAME,
  EMPTY_CONFIG,
  parseConfig,
  readConfigFile,
  resolveConfigFile,
  serializeConfig,
  writeConfigFile,
} from '../config.js'

const here = dirname(fileURLToPath(import.meta.url))

/** Run `fn` against a fresh temp directory, then remove it. */
async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-flatmap-config-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// The file's location
// ---------------------------------------------------------------------------

test('the config file lives in the plugin data directory under $DSH_HOME', () => {
  assert.equal(CONFIG_FILE_NAME, 'config.yaml')
  const path = resolveConfigFile({ env: { DSH_HOME: '/tmp/fake-home' } })
  assert.equal(path, join('/tmp/fake-home', 'dsh-model-flatmap', 'config.yaml'))
})

test('the config file falls back to ~/.dsh when $DSH_HOME is unset or blank', () => {
  const home = resolveConfigFile({ env: {} })
  assert.match(home, /\.dsh[\\/]dsh-model-flatmap[\\/]config\.yaml$/)
  // A blank value is "not set", exactly as the telemetry state file treats it.
  const blank = resolveConfigFile({ env: { DSH_HOME: '   ' } })
  assert.equal(blank, home)
})

// ---------------------------------------------------------------------------
// Parsing — the file is hand-edited, so the parser is the trust boundary
// ---------------------------------------------------------------------------

test('a full config document parses into hidden keys and aliases', () => {
  const text = [
    '# dsh-model-flatmap 插件自有配置',
    'hidden:',
    '  - third-party',
    '  - third-party/grok-4',
    'aliases:',
    '  third-party: 第三方',
    '  deepseek-account: DeepSeek 账号',
    '',
  ].join('\n')
  const config = parseConfig(text)
  assert.deepEqual([...config.hidden].sort(), ['third-party', 'third-party/grok-4'])
  assert.equal(config.aliases.get('third-party'), '第三方')
  assert.equal(config.aliases.get('deepseek-account'), 'DeepSeek 账号')
})

test('an empty or comment-only file means the built-in defaults', () => {
  for (const text of ['', '\n\n', '# only a comment\n', '   \n']) {
    const config = parseConfig(text)
    assert.equal(config.hidden.size, 0, `hidden is empty for ${JSON.stringify(text)}`)
    assert.equal(config.aliases.size, 0, `aliases is empty for ${JSON.stringify(text)}`)
  }
})

test('a missing section is the default, not an error', () => {
  const onlyHidden = parseConfig('hidden:\n  - p\n')
  assert.deepEqual([...onlyHidden.hidden], ['p'])
  assert.equal(onlyHidden.aliases.size, 0)

  const onlyAliases = parseConfig('aliases:\n  p: Name\n')
  assert.equal(onlyAliases.hidden.size, 0)
  assert.equal(onlyAliases.aliases.get('p'), 'Name')
})

test('comments and blank lines are ignored wherever they appear', () => {
  const text = [
    '# leading comment',
    '',
    'hidden:',
    '  # a comment inside the list',
    '  - p',
    '',
    '  - p/m   # trailing comment on an item',
    '',
    'aliases:',
    '  p: Name  # trailing comment on a value',
    '',
  ].join('\n')
  const config = parseConfig(text)
  assert.deepEqual([...config.hidden].sort(), ['p', 'p/m'])
  assert.equal(config.aliases.get('p'), 'Name')
})

test('quoted values keep their spaces and colons', () => {
  const text = [
    'aliases:',
    '  "p": "A Name: With Colon"',
    "  'q': '  padded  '",
    '',
  ].join('\n')
  const config = parseConfig(text)
  assert.equal(config.aliases.get('p'), 'A Name: With Colon')
  assert.equal(config.aliases.get('q'), '  padded  ')
})

test('a malformed document is rejected, never silently coerced', () => {
  // Each of these is a real hand-edit mistake. Coercing them to "empty config"
  // would silently un-hide every model the user had switched off, and they
  // would have no way to tell why.
  const bad = [
    ['a list at the top level', '- one\n- two\n'],
    ['a scalar at the top level', 'just a string\n'],
    ['an unknown top-level key', 'unknown:\n  - p\n'],
    ['a section that is a scalar', 'hidden: yes\n'],
    ['an alias entry with no value', 'aliases:\n  p:\n'],
    ['a tab-indented item', 'hidden:\n\t- p\n'],
  ]
  for (const [why, text] of bad) {
    assert.throws(() => parseConfig(text), /config|yaml/i, why)
  }
})

test('an empty hidden key or alias name is dropped, not stored as blank', () => {
  const config = parseConfig('hidden:\n  - ""\naliases:\n  "": Name\n')
  assert.equal(config.hidden.size, 0)
  assert.equal(config.aliases.size, 0)
})

// ---------------------------------------------------------------------------
// Serialising — the file is also written by the plugin, so it must round-trip
// ---------------------------------------------------------------------------

test('a config round-trips through text without losing a key', () => {
  const original = {
    hidden: new Set(['p', 'p/m', 'other/x']),
    aliases: new Map([['p', '第三方'], ['q', 'A: B']]),
  }
  const back = parseConfig(serializeConfig(original))
  assert.deepEqual([...back.hidden].sort(), [...original.hidden].sort())
  assert.deepEqual([...back.aliases.entries()].sort(), [...original.aliases.entries()].sort())
})

test('the serialised file is stable, sorted and hand-readable', () => {
  const text = serializeConfig({
    hidden: new Set(['z', 'a']),
    aliases: new Map([['z', 'Zed'], ['a', 'Ay']]),
  })
  // Sorted, so a diff of two saves shows only real changes.
  assert.match(text, /hidden:\n {2}- a\n {2}- z\n/)
  assert.match(text, /aliases:\n {2}a: Ay\n {2}z: Zed\n/)
  // A header explains what the file is, since a user will open it.
  assert.match(text, /^#/)
  assert.equal(text.endsWith('\n'), true, 'the file ends with a newline')
})

test('an empty config serialises to a file that parses back to empty', () => {
  const text = serializeConfig(EMPTY_CONFIG)
  const back = parseConfig(text)
  assert.equal(back.hidden.size, 0)
  assert.equal(back.aliases.size, 0)
})

test('a value that needs quoting is quoted, and still parses back', () => {
  const tricky = new Map([
    ['p', 'has: colon'],
    ['q', '#looks like a comment'],
    ['r', '  padded  '],
    ['s', 'true'],
  ])
  const back = parseConfig(serializeConfig({ hidden: new Set(), aliases: tricky }))
  for (const [id, name] of tricky) {
    assert.equal(back.aliases.get(id), name, `alias ${id} survives the round-trip`)
  }
})

// ---------------------------------------------------------------------------
// Reading and writing the file
// ---------------------------------------------------------------------------

test('a missing config file reads as the built-in defaults', async () => {
  await withTempDir(async (dir) => {
    const config = readConfigFile(join(dir, 'nope.yaml'))
    assert.equal(config.hidden.size, 0)
    assert.equal(config.aliases.size, 0)
  })
})

test('writing creates the directory and the file, 0600', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'nested', 'dsh-model-flatmap', 'config.yaml')
    writeConfigFile(path, { hidden: new Set(['p']), aliases: new Map([['p', 'Name']]) })
    const info = await stat(path)
    assert.equal(info.isFile(), true)
    // Not secret, but a local preference has no business being world-readable.
    assert.equal(info.mode & 0o777, 0o600)
    const back = readConfigFile(path)
    assert.deepEqual([...back.hidden], ['p'])
    assert.equal(back.aliases.get('p'), 'Name')
  })
})

test('a write replaces the file atomically, leaving no temp file behind', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'config.yaml')
    writeConfigFile(path, { hidden: new Set(['old']), aliases: new Map() })
    writeConfigFile(path, { hidden: new Set(['new']), aliases: new Map() })
    assert.deepEqual([...readConfigFile(path).hidden], ['new'])
    const leftovers = (await import('node:fs')).readdirSync(dir).filter(name => name !== 'config.yaml')
    assert.deepEqual(leftovers, [], 'no .tmp file is left behind')
  })
})

test('a malformed file on disk throws rather than reading as empty', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'config.yaml')
    await writeFile(path, 'hidden: yes\n', 'utf8')
    // The caller decides whether to fall back; the reader must not pretend the
    // file said "nothing is hidden".
    assert.throws(() => readConfigFile(path), /config|yaml/i)
  })
})

test('the written file is UTF-8 and keeps non-ASCII names intact', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'config.yaml')
    writeConfigFile(path, { hidden: new Set(), aliases: new Map([['p', '第三方 Provider']]) })
    const text = await readFile(path, 'utf8')
    assert.match(text, /第三方 Provider/)
    assert.equal(readConfigFile(path).aliases.get('p'), '第三方 Provider')
  })
})
