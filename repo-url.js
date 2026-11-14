/**
 * Host half of the panel's "open the project page" button.
 *
 * The panel's browser half cannot read the checkout: a client plugin has no
 * filesystem and no subprocess. So the Host reads the repository's configured
 * remotes here and hands the browser ONE ready-to-open URL.
 *
 * What this module is careful about, and why:
 *
 * 1. **The URL is derived, never hardcoded.** `git remote get-url` is asked for
 *    every remote this checkout configures, `origin` first, and the first URL
 *    that resolves to a GitHub repository becomes the answer. Renaming the
 *    repository, moving it to another owner, or adding a fork upstream all
 *    change the answer without touching this file.
 *
 * 2. **Every remote spelling becomes a browser URL.** `git@github.com:owner/repo.git`,
 *    `https://github.com/owner/repo.git`, `ssh://git@github.com/owner/repo`,
 *    `git://github.com/owner/repo.git` and `github.com:owner/repo` all name the
 *    same page; the `.git` suffix and any trailing slash do not belong in it.
 *
 * 3. **A fallback is a last resort, not the answer.** The user's decision was
 *    explicit: when the checkout has no usable GitHub remote (an npm-installed
 *    copy ships no `.git`, a plain tarball has none either), the button must
 *    still reach this project's own page. The fallback is therefore a named
 *    constant that the resolution path can OVERRIDE, and the result reports
 *    which one it used so the button can say so honestly.
 *
 * Nothing here writes anything: it is one `git remote get-url` read and a
 * string transform.
 *
 * @module dsh-model-flatmap/repo-url
 */

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * The page this bundle opens when the checkout configures no usable GitHub
 * remote. Declared once, at the top, so it is obviously a fallback rather than
 * the source of truth: {@link resolveProjectUrl} only returns it after every
 * configured remote has been tried and rejected.
 *
 * It matches `package.json`'s `repository`/`homepage`, and a test pins that
 * agreement so the two can never drift apart.
 */
export const FALLBACK_PROJECT_URL = 'https://github.com/zuosus/dsh-model-flatmap'

/** Remotes consulted in this order; `origin` is the conventional checkout name. */
const REMOTE_ORDER = ['origin', 'upstream']

/** Milliseconds one `git` read may take. A hung git must not hold the button. */
const GIT_TIMEOUT_MS = 5_000

/**
 * Directory of this module, used as the default `git` working directory.
 *
 * `import.meta.url` points at this file inside the installed package, which
 * sits inside the checkout when the profile links the package (the normal
 * development arrangement) and inside `node_modules` when it was installed
 * from the registry. `git rev-parse` walks up from there, so the linked case
 * finds the checkout's own `.git`, and the installed case finds whatever
 * repository encloses the profile — usually none, which is exactly when the
 * fallback is the right answer.
 *
 * @returns the absolute directory path, or `undefined` when unavailable.
 */
export function moduleDirectory() {
  try {
    return fileURLToPath(new URL('.', import.meta.url))
  } catch {
    return undefined
  }
}

/**
 * Turn one configured remote URL into the browser URL of its repository page.
 *
 * Accepts the scp-like form (`git@host:owner/repo.git`) that git writes for an
 * SSH clone as well as every URL form (`ssh://`, `https://`, `git://`,
 * `git+https://`). A non-GitHub host, a missing owner/repo pair, or a string
 * that is not a remote at all yields `null`, so the caller can try the next
 * remote instead of publishing a broken link.
 *
 * @param {unknown} remote - one remote URL as `git` reports it.
 * @returns {string|null} `https://github.com/<owner>/<repo>`, or `null`.
 */
export function githubPageUrl(remote) {
  if (typeof remote !== 'string') return null
  const trimmed = remote.trim()
  if (trimmed === '') return null

  const segments = repoSegments(trimmed)
  if (segments === null) return null
  const { host, owner, repo } = segments
  // Only github.com: another host has no page at this address, and silently
  // rewriting it to github.com would open the wrong repository.
  if (host.toLowerCase() !== 'github.com') return null
  return `https://github.com/${owner}/${repo}`
}

/**
 * Split a remote spelling into its host and its `owner` / `repo` pair.
 *
 * The two shapes git accepts are handled explicitly rather than with one
 * regex: an scp-like `user@host:path` (no scheme, no `//`) and a real URL.
 *
 * @param {string} remote - a trimmed remote URL.
 * @returns {{host: string, owner: string, repo: string}|null} the parts, or null.
 */
function repoSegments(remote) {
  let host
  let path
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/u.exec(remote)
  if (scp !== null && !/^[a-z][a-z\d+.-]*:\/\//iu.test(remote)) {
    host = scp[1]
    path = scp[2]
  } else {
    let parsed
    try {
      parsed = new URL(remote.replace(/^git\+/u, ''))
    } catch {
      return null
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:'
      && parsed.protocol !== 'ssh:' && parsed.protocol !== 'git:') return null
    host = parsed.hostname
    path = parsed.pathname
  }
  if (typeof host !== 'string' || host === '' || typeof path !== 'string') return null

  const parts = path.replace(/^\/+/u, '').replace(/\/+$/u, '').split('/')
  if (parts.length < 2) return null
  const owner = parts[0]
  // A `.git` suffix is a clone detail; the page never carries it.
  const repo = parts[1].replace(/\.git$/iu, '')
  if (owner === '' || repo === '') return null
  return { host, owner, repo }
}

/**
 * Run one `git` command and return its trimmed stdout.
 *
 * Failures are values, not exceptions: a directory outside any repository, a
 * machine without git, and a timeout all mean "this checkout has no remote",
 * which the caller answers with the fallback rather than an error.
 *
 * @param {string[]} args - git arguments, never shell-interpreted.
 * @param {string} cwd - directory to run in.
 * @param {typeof execFile} [run] - injectable runner, for tests.
 * @returns {Promise<string|null>} stdout, or `null` on any failure.
 */
export function readGit(args, cwd, run = execFile) {
  return new Promise(resolve => {
    let settled = false
    const done = value => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      run('git', args, {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        // Never prompt, never page: this read must not be able to block.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      }, (error, stdout) => {
        if (error !== null && error !== undefined) return done(null)
        done(typeof stdout === 'string' ? stdout.trim() : null)
      })
    } catch {
      done(null)
    }
  })
}

/**
 * Read every remote URL this checkout configures, `origin` first.
 *
 * `git remote -v` lists each remote twice (fetch and push); the duplicates are
 * dropped so one broken remote is not tried twice.
 *
 * @param {string} cwd - directory to run in.
 * @param {typeof execFile} [run] - injectable runner, for tests.
 * @returns {Promise<{name: string, url: string}[]>} configured remotes.
 */
export async function readRemotes(cwd, run = execFile) {
  const listing = await readGit(['remote', '-v'], cwd, run)
  if (listing === null || listing === '') return []
  const found = new Map()
  for (const line of listing.split('\n')) {
    // `<name>\t<url> (fetch|push)`
    const match = /^(\S+)\s+(\S+)\s+\((?:fetch|push)\)$/u.exec(line.trim())
    if (match === null) continue
    const name = match[1]
    if (found.has(name)) continue
    found.set(name, match[2])
  }
  const remotes = [...found].map(([name, url]) => ({ name, url }))
  // Configured order is arbitrary; `origin` (then `upstream`) decides first.
  const rank = name => {
    const index = REMOTE_ORDER.indexOf(name)
    return index === -1 ? REMOTE_ORDER.length : index
  }
  return remotes.sort((left, right) => rank(left.name) - rank(right.name))
}

/**
 * Resolve the page this bundle's button opens.
 *
 * @param {object} [options] - overrides, all optional.
 * @param {string} [options.cwd] - checkout directory; defaults to this module's.
 * @param {typeof execFile} [options.run] - injectable runner, for tests.
 * @returns {Promise<{url: string, source: 'remote'|'fallback', remote?: string}>}
 *   `source` says whether the URL came from a configured remote or the
 *   fallback, so the button can describe itself truthfully.
 */
export async function resolveProjectUrl(options = {}) {
  const cwd = typeof options.cwd === 'string' && options.cwd !== '' ? options.cwd : moduleDirectory()
  if (cwd !== undefined) {
    for (const remote of await readRemotes(cwd, options.run)) {
      const url = githubPageUrl(remote.url)
      if (url !== null) return { url, source: 'remote', remote: remote.name }
    }
  }
  return { url: FALLBACK_PROJECT_URL, source: 'fallback' }
}
