/**
 * Host-half tests for the project-link button.
 *
 * These pin the two things that make the feature honest:
 *
 * 1. **The URL is derived from the checkout, never from a constant.** Every
 *    remote spelling git writes becomes the same repository page, a non-GitHub
 *    host is refused rather than rewritten, and a checkout whose remotes all
 *    fail is answered with the documented fallback.
 * 2. **The fallback is the only hardcoded address.** It is compared against
 *    `package.json`'s own `repository`/`homepage` so the three can never drift
 *    apart, and it is reachable only after every configured remote was tried.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  FALLBACK_PROJECT_URL,
  githubPageUrl,
  readGit,
  readRemotes,
  resolveProjectUrl,
} from '../repo-url.js'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

/**
 * Build a fake `execFile` that answers one command table.
 *
 * @param {Record<string, string|Error|null>} table - command key (`git remote -v`) to stdout.
 * @returns {{run: Function, calls: Array<{file: string, args: string[]}>}} runner + recorded calls.
 */
function fakeExec(table) {
  const calls = []
  const run = (file, args, options, callback) => {
    calls.push({ file, args: [...args], cwd: options?.cwd })
    const key = `${file} ${args.join(' ')}`
    const answer = table[key]
    if (answer instanceof Error) {
      callback(answer, '', String(answer.message))
      return
    }
    if (answer === undefined || answer === null) {
      callback(Object.assign(new Error('not found'), { code: 'ENOENT' }), '', '')
      return
    }
    callback(null, answer, '')
  }
  return { run, calls }
}

// ---------------------------------------------------------------------------
// Remote spelling → repository page
// ---------------------------------------------------------------------------
test('every git remote spelling for this repository becomes the same page', () => {
  const expected = 'https://github.com/zuosus/dsh-model-flatmap'
  const spellings = [
    'git@github.com:zuosus/dsh-model-flatmap.git',
    'git@github.com:zuosus/dsh-model-flatmap',
    'https://github.com/zuosus/dsh-model-flatmap.git',
    'https://github.com/zuosus/dsh-model-flatmap',
    'https://github.com/zuosus/dsh-model-flatmap/',
    'ssh://git@github.com/zuosus/dsh-model-flatmap.git',
    'ssh://git@github.com:22/zuosus/dsh-model-flatmap.git',
    'git://github.com/zuosus/dsh-model-flatmap.git',
    'git+https://github.com/zuosus/dsh-model-flatmap.git',
    'github.com:zuosus/dsh-model-flatmap',
    '  git@github.com:zuosus/dsh-model-flatmap.git  ',
  ]
  for (const spelling of spellings) {
    assert.equal(githubPageUrl(spelling), expected, spelling)
  }
})

test('the .git suffix and trailing slash never reach the page URL', () => {
  const url = githubPageUrl('https://github.com/owner/repo.git/')
  assert.equal(url, 'https://github.com/owner/repo')
  assert.ok(!url.includes('.git'), 'a clone suffix is not part of a web page address')
})

test('a non-GitHub host is refused, never rewritten to github.com', () => {
  // Rewriting would open a DIFFERENT repository than the one configured, which
  // is worse than opening the fallback: the user would be told nothing.
  for (const remote of [
    'git@gitlab.com:owner/repo.git',
    'https://gitlab.com/owner/repo.git',
    'https://bitbucket.org/owner/repo.git',
    'ssh://git@git.example.com/owner/repo.git',
    'https://codeberg.org/owner/repo',
  ]) {
    assert.equal(githubPageUrl(remote), null, remote)
  }
})

test('a remote without an owner/repo pair is refused', () => {
  for (const remote of [
    'https://github.com/owner',
    'git@github.com:owner',
    'https://github.com/',
    'git@github.com:',
    '',
    '   ',
    'not a remote at all',
    '/local/path/repo.git',
    'file:///srv/git/repo.git',
  ]) {
    assert.equal(githubPageUrl(remote), null, JSON.stringify(remote))
  }
})

test('a non-string remote is refused instead of throwing', () => {
  for (const value of [null, undefined, 42, {}, []]) {
    assert.equal(githubPageUrl(value), null, String(value))
  }
})

test('an unsupported URL scheme is refused', () => {
  assert.equal(githubPageUrl('ftp://github.com/owner/repo.git'), null)
  assert.equal(githubPageUrl('javascript:alert(1)//github.com/owner/repo'), null)
})

test('github.com is matched case-insensitively', () => {
  assert.equal(githubPageUrl('git@GitHub.com:owner/repo.git'), 'https://github.com/owner/repo')
  assert.equal(githubPageUrl('https://GitHub.COM/owner/repo.git'), 'https://github.com/owner/repo')
})

// ---------------------------------------------------------------------------
// Remote listing
// ---------------------------------------------------------------------------
test('remotes are de-duplicated from the fetch/push listing and origin ranks first', async () => {
  // `git remote -v` prints every remote twice, and its order is arbitrary.
  const { run } = fakeExec({
    'git remote -v': [
      'upstream\tgit@github.com:upstream/repo.git (fetch)',
      'upstream\tgit@github.com:upstream/repo.git (push)',
      'origin\tgit@github.com:zuosus/dsh-model-flatmap.git (fetch)',
      'origin\tgit@github.com:zuosus/dsh-model-flatmap.git (push)',
    ].join('\n'),
  })
  const remotes = await readRemotes('/some/checkout', run)
  assert.deepEqual(remotes, [
    { name: 'origin', url: 'git@github.com:zuosus/dsh-model-flatmap.git' },
    { name: 'upstream', url: 'git@github.com:upstream/repo.git' },
  ])
})

test('a checkout with no remotes lists none', async () => {
  const { run } = fakeExec({ 'git remote -v': '' })
  assert.deepEqual(await readRemotes('/some/checkout', run), [])
})

test('a failing git read is a value, not an exception', async () => {
  const { run } = fakeExec({ 'git remote -v': new Error('not a git repository') })
  assert.deepEqual(await readRemotes('/some/checkout', run), [])
  assert.equal(await readGit(['remote', '-v'], '/some/checkout', run), null)
})

test('a runner that throws synchronously is contained', async () => {
  const run = () => { throw new Error('spawn failed') }
  assert.equal(await readGit(['remote', '-v'], '/some/checkout', run), null)
})

// ---------------------------------------------------------------------------
// Resolution: the configured remote wins, the fallback is last
// ---------------------------------------------------------------------------
test('a configured GitHub remote decides the URL, and says so', async () => {
  const { run } = fakeExec({
    'git remote -v': 'origin\tgit@github.com:owner/other-name.git (fetch)\norigin\tgit@github.com:owner/other-name.git (push)',
  })
  const result = await resolveProjectUrl({ cwd: '/checkout', run })
  assert.deepEqual(result, {
    url: 'https://github.com/owner/other-name',
    source: 'remote',
    remote: 'origin',
  })
})

test('origin is skipped when it is not GitHub, and a later GitHub remote is used', async () => {
  const { run } = fakeExec({
    'git remote -v': [
      'origin\tgit@gitlab.com:owner/repo.git (fetch)',
      'origin\tgit@gitlab.com:owner/repo.git (push)',
      'mirror\thttps://github.com/owner/mirror.git (fetch)',
      'mirror\thttps://github.com/owner/mirror.git (push)',
    ].join('\n'),
  })
  const result = await resolveProjectUrl({ cwd: '/checkout', run })
  assert.equal(result.url, 'https://github.com/owner/mirror')
  assert.equal(result.source, 'remote')
  assert.equal(result.remote, 'mirror')
})

test('a checkout with no usable remote falls back to this project page', async () => {
  const { run } = fakeExec({
    'git remote -v': 'origin\tgit@gitlab.com:owner/repo.git (fetch)\norigin\tgit@gitlab.com:owner/repo.git (push)',
  })
  const result = await resolveProjectUrl({ cwd: '/checkout', run })
  assert.deepEqual(result, { url: FALLBACK_PROJECT_URL, source: 'fallback' })
})

test('a directory that is not a repository falls back', async () => {
  const { run } = fakeExec({ 'git remote -v': new Error('fatal: not a git repository') })
  const result = await resolveProjectUrl({ cwd: '/tmp', run })
  assert.deepEqual(result, { url: FALLBACK_PROJECT_URL, source: 'fallback' })
})

test('the fallback is this package\'s own repository, and never a different project', () => {
  assert.equal(FALLBACK_PROJECT_URL, 'https://github.com/zuosus/dsh-model-flatmap')
  // The three places that name the project must agree, so a rename cannot
  // leave the button pointing at an abandoned address.
  const fromRepository = String(manifest.repository.url)
    .replace(/^git\+/u, '')
    .replace(/\.git$/u, '')
  assert.equal(fromRepository, FALLBACK_PROJECT_URL, 'package.json repository.url')
  assert.equal(manifest.homepage.replace(/#.*$/u, ''), FALLBACK_PROJECT_URL, 'package.json homepage')
})

test('the fallback URL is itself a valid page address', () => {
  assert.equal(githubPageUrl(FALLBACK_PROJECT_URL), FALLBACK_PROJECT_URL,
    'the fallback survives the same conversion the remotes go through')
})

test('the browser half repeats the same fallback, so the two halves cannot drift', () => {
  // The browser half cannot import this module (it is a Host-only ESM file), so
  // it repeats the address. This test is what keeps the repetition honest.
  const client = readFileSync(join(here, '..', 'client.js'), 'utf8')
  const declared = /const PROJECT_LINK_FALLBACK = '([^']+)'/u.exec(client)
  assert.ok(declared !== null, 'the browser half declares its fallback')
  assert.equal(declared[1], FALLBACK_PROJECT_URL, 'both halves name the same page')
})

test('the browser half asks the same route path the Host registers', () => {
  const client = readFileSync(join(here, '..', 'client.js'), 'utf8')
  const declared = /const PROJECT_LINK_PATH = '([^']+)'/u.exec(client)
  assert.ok(declared !== null, 'the browser half declares the route path')
  // The Host route is absolute (`/dsh-model-flatmap/project-link`); the browser
  // fetches it document-relative, exactly as every other app-owned route is
  // fetched. Comparing the leading slash away pins the two spellings together.
  const host = readFileSync(join(here, '..', 'index.js'), 'utf8')
  const registered = /PROJECT_LINK_PATH = '([^']+)'/u.exec(host)
  assert.ok(registered !== null, 'the Host half declares the route path')
  assert.equal(declared[1], registered[1].replace(/^\//u, ''))
})

// ---------------------------------------------------------------------------
// Host entry: the route is registered, and its failures never cost the plugin
// ---------------------------------------------------------------------------
test('the Host entry registers the project-link route and answers JSON', async () => {
  const { apply, PROJECT_LINK_PATH } = await import('../index.js')
  const routes = []
  apply({
    get: name => (name === 'webServer'
      ? { register: route => { routes.push(route); return () => {} } }
      : undefined),
    effect: fn => fn(),
    logger: { warn: () => {} },
  })
  assert.equal(routes.length, 2, 'the Host registers the project-link and telemetry-settings routes')
  const linkRoute = routes.find(route => route.path === PROJECT_LINK_PATH)
  assert.equal(linkRoute.kind, 'exact')
  assert.notEqual(linkRoute, undefined)

  const answer = await invoke(linkRoute, 'GET')
  assert.equal(answer.status, 200)
  assert.match(String(answer.headers['content-type']), /application\/json/u)
  assert.equal(answer.headers['cache-control'], 'no-store', 'a URL that can change is never cached')
  const payload = JSON.parse(answer.body)
  assert.match(payload.url, /^https:\/\/github\.com\//u)
  assert.ok(payload.source === 'remote' || payload.source === 'fallback')
})

test('the route rejects methods it does not own', async () => {
  const { apply } = await import('../index.js')
  const routes = []
  apply({
    get: name => (name === 'webServer' ? { register: r => { routes.push(r); return () => {} } } : undefined),
    effect: fn => fn(),
    logger: { warn: () => {} },
  })
  const answer = await invoke(routes[0], 'POST')
  assert.equal(answer.status, 405)
  assert.equal(answer.headers.allow, 'GET, HEAD')
})

test('the route honours the Host trust fence, and fails closed when it cannot answer', async () => {
  const { apply } = await import('../index.js')
  const build = connection => {
    const routes = []
    apply({
      get: name => {
        if (name === 'webServer') return { register: r => { routes.push(r); return () => {} } }
        if (name === 'connection') return connection
        return undefined
      },
      effect: fn => fn(),
      logger: { warn: () => {} },
    })
    return routes[0]
  }
  assert.equal((await invoke(build({ requestRejection: () => 403 }), 'GET')).status, 403,
    'a rejected peer is refused')
  assert.equal((await invoke(build({ requestRejection: () => { throw new Error('boom') } }), 'GET')).status, 403,
    'a fence that cannot answer must not open the route')
  assert.equal((await invoke(build({ requestRejection: () => undefined }), 'GET')).status, 200,
    'an admitted peer is served')
})

test('a Host context with no web server or no effect still applies cleanly', async () => {
  const { apply } = await import('../index.js')
  // No services at all: applying must not throw, it just registers nothing.
  assert.doesNotThrow(() => apply({ logger: { warn: () => {} } }))
  // A web server but no `ctx.effect`: the route is still registered, because a
  // button that silently never works is worse than a route left behind.
  const routes = []
  assert.doesNotThrow(() => apply({
    get: name => (name === 'webServer' ? { register: r => { routes.push(r); return () => {} } } : undefined),
    logger: { warn: () => {} },
  }))
  assert.equal(routes.length, 2, 'both routes are registered without a lifecycle helper')
})

test('a registration that throws does not escape apply()', async () => {
  const { apply } = await import('../index.js')
  const warnings = []
  assert.doesNotThrow(() => apply({
    get: name => (name === 'webServer'
      ? { register: () => { throw new Error('duplicate exact route') } }
      : undefined),
    effect: fn => fn(),
    logger: { warn: message => warnings.push(message) },
  }))
})

/** Invoke one route handler with a minimal response recorder. */
async function invoke(route, method) {
  let captured = null
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(body) { captured = { status: this.statusCode, headers: this.headers, body } },
  }
  await route.handler({ method }, res)
  return captured
}
