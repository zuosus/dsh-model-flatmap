/**
 * Packaging tests: what `npm publish` would actually ship.
 *
 * These exist because 1.6.0 shipped BROKEN. `index.js` imports `./config.js`,
 * but `config.js` was never added to the `files` array, so npm left it out of
 * the tarball. Every install of that version failed at load time with
 * `ERR_MODULE_NOT_FOUND` — the Host half could not even be imported, which
 * takes the whole plugin down, not just one feature.
 *
 * Nothing caught it because every test runs inside the checkout, where
 * `config.js` is simply present. The gap is not "is the code correct" but
 * "does the code that ships coexist with the manifest" — a question only a
 * test against the manifest can answer.
 */
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/**
 * Every relative module a file imports, as repo-relative paths.
 *
 * Only `./`-style specifiers matter here: a bare specifier is a dependency,
 * and this package deliberately ships none.
 *
 * @param {string} file - repo-relative source file.
 * @returns {string[]} repo-relative imports.
 */
function relativeImports(file) {
  const source = readFileSync(join(root, file), 'utf8')
  const out = new Set()
  const patterns = [
    /\bfrom\s+'(\.[^']*)'/gu,
    /\bimport\s*\(\s*'(\.[^']*)'/gu,
    /\bimport\s+'(\.[^']*)'/gu,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) out.add(resolveSpecifier(file, match[1]))
  }
  return [...out]
}

/**
 * Resolve one relative specifier to a repo-relative path.
 *
 * @param {string} from - repo-relative importing file.
 * @param {string} spec - the `./x.js` specifier.
 * @returns {string} repo-relative imported path.
 */
function resolveSpecifier(from, spec) {
  return relative(root, resolve(root, dirname(from), spec))
}

/** Whether a path matches one `files` entry, including its `dir/**` forms. */
function matchesEntry(path, entry) {
  if (entry.endsWith('/*.json')) {
    const prefix = entry.slice(0, -'*.json'.length)
    return path.startsWith(prefix) && path.endsWith('.json')
  }
  if (entry.endsWith('/')) return path.startsWith(entry)
  // A bare directory entry ships everything under it.
  try {
    return statSync(join(root, entry)).isDirectory()
      ? path.startsWith(`${entry}/`)
      : path === entry
  } catch {
    return path === entry
  }
}

/**
 * Which `files` entry (if any) ships a given path.
 *
 * npm also always includes `package.json`, `README*` and `LICENSE`, plus the
 * entry points named by `main`/`exports`; those are not what this file checks,
 * because they cannot silently go missing.
 *
 * @param {string} path - repo-relative path.
 * @returns {string|undefined} the matching entry.
 */
function shippedBy(path, entries) {
  return entries.find(entry => matchesEntry(path, entry))
}

test('every module the Host imports is actually published', () => {
  // The 1.6.0 regression: index.js → ./config.js, absent from `files`.
  const entries = manifest.files ?? []
  assert.ok(Array.isArray(entries) && entries.length > 0, 'the package declares what it ships')

  const missing = []
  // Walk the Host half's import graph; the client half has no relative imports
  // (the two halves cannot share a module, see DEC-058), but include it anyway
  // so a future split is covered.
  const queue = ['index.js', 'client.js']
  const seen = new Set()
  while (queue.length > 0) {
    const file = queue.shift()
    if (seen.has(file)) continue
    seen.add(file)
    if (shippedBy(file, entries) === undefined) missing.push(file)
    for (const next of relativeImports(file)) {
      if (!seen.has(next)) queue.push(next)
    }
  }

  assert.deepEqual(missing, [],
    `these files are imported but would not ship: ${missing.join(', ')}`)
})

test('the shipped entry points resolve inside the tarball', () => {
  const entries = manifest.files ?? []
  // npm ALWAYS packs these three regardless of `files`; they cannot go missing,
  // so asserting them against the array would be a false positive.
  const always = /^(package\.json|README[^/]*|LICEN[CS]E[^/]*)$/u
  const shipped = []
  const collect = value => {
    if (typeof value === 'string') shipped.push(value.replace(/^\.\//u, ''))
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(collect)
  }
  collect(manifest.exports ?? {})
  for (const target of shipped) {
    const path = target.replace(/^\.\//u, '')
    if (always.test(path)) continue
    // A glob export covers a directory; the concrete files still have to ship.
    if (path.includes('*')) continue
    assert.ok(shippedBy(path, entries) !== undefined, `${path} is exported but not shipped`)
  }
})

test('every file index.js needs at runtime is a real file', () => {
  // Belt and braces: the walk above proves the manifest covers them, this
  // proves the checkout has them at all (a renamed module must not be "fixed"
  // by adding a stale name to `files`).
  for (const file of ['index.js', 'client.js', 'config.js', 'telemetry.js', 'repo-url.js']) {
    assert.doesNotThrow(() => statSync(join(root, file)), `${file} exists`)
  }
  for (const file of ['index.js', 'client.js']) {
    for (const imported of relativeImports(file)) {
      assert.doesNotThrow(() => statSync(join(root, imported)), `${imported} exists`)
    }
  }
})

test('the package still declares zero runtime dependencies', () => {
  // The repo's standing constraint (see the header of config.js): the plugin
  // copies behaviour rather than importing sibling plugins. A dependency would
  // also make the tarball unable to load from a bare `npm install`.
  assert.equal(manifest.dependencies, undefined, 'no runtime dependencies')
})
