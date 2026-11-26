/**
 * The plugin's own config file: `$DSH_HOME/dsh-model-flatmap/config.yaml`.
 *
 * Why a file at all (DEC-060). The visibility switches and provider renames used
 * to live only in the browser's `localStorage`. That made them invisible: not in
 * a backup, not in a diff, not hand-editable, and gone the moment the app's
 * origin changed. The user asked for this file to be the source of truth, so it
 * is: the browser mirrors its choice here (the same shape as the telemetry
 * toggle, DEC-035), and this half reads it back on every start.
 *
 * **Zero runtime dependencies.** The repo's standing constraint is that the
 * plugin ships no `dependencies` — the sibling plugins' code is copied in
 * behaviour, never imported. So this is a small, deliberately narrow YAML
 * reader/writer for exactly the two shapes this file holds:
 *
 * ```yaml
 * hidden:
 *   - third-party
 *   - third-party/grok-4
 * aliases:
 *   third-party: 第三方
 * teamDefault: true
 * ```
 *
 * It is NOT a general YAML parser and must not grow into one. Anything outside
 * that shape is rejected loudly rather than guessed at: this file decides which
 * models a user sees, so a silent misread would un-hide models they deliberately
 * switched off, with no way for them to tell why.
 *
 * Two rules keep the failure modes honest:
 *
 * 1. **A missing file is the default; a broken file is an error.** Absence means
 *    "the user never configured anything". Corruption means "someone edited this
 *    and got it wrong", and the caller needs to know so it can warn instead of
 *    quietly resetting the user's choices.
 * 2. **A write is atomic and 0600.** A half-written config is worse than no
 *    write at all, and a local preference has no business being world-readable.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** File name inside the plugin's data directory. */
export const CONFIG_FILE_NAME = 'config.yaml'

/** The plugin's directory name under the DSH home. */
const PLUGIN_DIR_NAME = 'dsh-model-flatmap'

/** Environment variable the host itself honours for the DSH home directory. */
const DSH_HOME_ENV = 'DSH_HOME'

/** The two top-level keys this file may carry. Anything else is a typo. */
const KNOWN_SECTIONS = new Set(['hidden', 'aliases', 'teamDefault'])

/**
 * The built-in defaults: nothing hidden, nothing renamed.
 *
 * Frozen, and holding its own empty containers, so a caller that mutates the
 * result of a failed read cannot corrupt the default for everyone else. The
 * containers are fresh per access via `emptyConfig()` — this constant exists for
 * identity comparison and for the tests.
 */
export const EMPTY_CONFIG = Object.freeze({
  hidden: new Set(),
  aliases: new Map(),
  teamDefault: false,
})

/**
 * A fresh default config.
 *
 * @returns {{hidden: Set<string>, aliases: Map<string, string>}} empty config.
 */
function emptyConfig() {
  return { hidden: new Set(), aliases: new Map(), teamDefault: false }
}

/**
 * Expand a leading `~` to the user's home directory.
 *
 * @param {string} value - a path that may start with `~`.
 * @returns {string} the expanded path.
 */
function expandHomePath(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

/**
 * The DSH home directory, resolved the way the Host resolves it.
 *
 * Three rules, copied from the telemetry half so both agree: an explicit
 * `$DSH_HOME` wins, a blank value counts as unset, and the fallback is `~/.dsh`.
 *
 * @param {{env?: Record<string, string|undefined>}} [options] - injectable env.
 * @returns {string} absolute path.
 */
function resolveDshHome(options = {}) {
  const env = options.env ?? process.env
  const raw = env?.[DSH_HOME_ENV]
  const fromEnv = typeof raw === 'string' && raw.trim().length > 0 ? raw : undefined
  return resolve(expandHomePath(fromEnv ?? join(homedir(), '.dsh')))
}

/**
 * The absolute path of this plugin's config file.
 *
 * @param {{env?: Record<string, string|undefined>}} [options] - injectable env.
 * @returns {string} `$DSH_HOME/dsh-model-flatmap/config.yaml`.
 */
export function resolveConfigFile(options = {}) {
  return join(resolveDshHome(options), PLUGIN_DIR_NAME, CONFIG_FILE_NAME)
}

/**
 * Strip a trailing `# comment` from one line, respecting quotes.
 *
 * `#` only starts a comment when it is at the start of the line or preceded by
 * whitespace AND is not inside a quoted run — otherwise `#looks like a comment`
 * as an alias value would be truncated.
 *
 * @param {string} line - one raw line.
 * @returns {string} the line without its comment.
 */
function stripComment(line) {
  let quote = null
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quote !== null) {
      if (char === '\\' && quote === '"') { index += 1; continue }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index)
  }
  return line
}

/**
 * Unquote one scalar, or return it trimmed.
 *
 * Handles the two quote styles this writer emits. A double-quoted scalar gets
 * the escapes the writer produces (`\\`, `\"`, `\n`); a single-quoted one is
 * literal apart from the doubled-quote escape.
 *
 * @param {string} raw - the scalar text, possibly quoted.
 * @returns {string} the value.
 */
function parseScalar(raw) {
  const text = raw.trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\(["\\nt])/g, (_, char) => (
      char === 'n' ? '\n' : char === 't' ? '\t' : char
    ))
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'")
  }
  return text
}

/**
 * Parse the config document.
 *
 * Accepts exactly the shape documented at the top of this file. Anything else
 * throws: a typo must not silently reset the user's choices.
 *
 * @param {string} text - the file's contents.
 * @returns {{hidden: Set<string>, aliases: Map<string, string>}} the config.
 * @throws {Error} when the document is not this file's shape.
 */
export function parseConfig(text) {
  const config = emptyConfig()
  const source = String(text ?? '')
  if (source.trim().length === 0) return config

  let section = null
  const lines = source.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    if (/^\s*\t/.test(rawLine) || /^\t/.test(rawLine)) {
      throw new Error(`${CONFIG_FILE_NAME} 第 ${index + 1} 行用制表符缩进：YAML 只允许空格`)
    }
    const line = stripComment(rawLine)
    if (line.trim().length === 0) continue

    // A top-level key: no leading whitespace, `name:` at the end.
    const top = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (top !== null) {
      const [, key, rest] = top
      if (!KNOWN_SECTIONS.has(key)) {
        throw new Error(`${CONFIG_FILE_NAME} 第 ${index + 1} 行：未知的配置项 "${key}"（只支持 hidden / aliases）`)
      }
      const inline = rest.trim()
      if (inline.length > 0) {
        // `teamDefault` is a scalar that lives ON its key line; the two record
        // sections only accept their empty flow forms there. Anything else is a
        // mistake, not a value to guess at.
        if (key === 'teamDefault') {
          const value = parseScalar(inline)
          if (value !== 'true' && value !== 'false') {
            throw new Error(`${CONFIG_FILE_NAME} 第 ${index + 1} 行：teamDefault 只能是 true 或 false`)
          }
          config.teamDefault = value === 'true'
          section = null
          continue
        }
        const emptyFlow = (key === 'hidden' && inline === '[]') || (key === 'aliases' && inline === '{}')
        if (!emptyFlow) {
          throw new Error(`${CONFIG_FILE_NAME} 第 ${index + 1} 行："${key}" 下面必须是缩进的列表或映射`)
        }
        section = null
        continue
      }
      if (key === 'teamDefault') {
        // The writer always emits a value, so a bare key is a half-finished edit
        // rather than "false": say so instead of silently turning it off.
        throw new Error(`${CONFIG_FILE_NAME} 第 ${index + 1} 行：teamDefault 后面必须跟 true 或 false`)
      }
      section = key
      continue
    }

    if (section === null) {
      throw new Error(`${CONFIG_FILE_NAME} 第 ${index + 1} 行：内容必须写在 hidden 或 aliases 下面`)
    }

    const indented = /^\s+/.test(line)
    if (!indented) {
      throw new Error(`${CONFIG_FILE_NAME} 第 ${index + 1} 行：这一行没有缩进，无法归到 "${section}" 下面`)
    }
    const body = line.trim()

    if (section === 'teamDefault') {
      throw new Error(`${CONFIG_FILE_NAME} 第 ${index + 1} 行：teamDefault 是单个值，不写缩进内容`)
    }

    if (section === 'hidden') {
      const item = /^-\s*(.*)$/.exec(body)
      if (item === null) {
        throw new Error(`${CONFIG_FILE_NAME} 第 ${index + 1} 行：hidden 下面每一项都要以 "- " 开头`)
      }
      const key = parseScalar(item[1])
      // A blank key is a no-op rather than a hidden model nobody can name.
      if (key !== '') config.hidden.add(key)
      continue
    }

    // aliases: `id: name`, and the name must be present.
    const entry = /^([^:]+):\s*(.*)$/.exec(body)
    if (entry === null) {
      throw new Error(`${CONFIG_FILE_NAME} 第 ${index + 1} 行：aliases 下面每一项都要写成 "id: 名称"`)
    }
    const id = parseScalar(entry[1])
    const name = parseScalar(entry[2])
    if (id === '') continue
    if (name === '') {
      throw new Error(`${CONFIG_FILE_NAME} 第 ${index + 1} 行：别名 "${id}" 没有值（想恢复原名，请删掉这一行）`)
    }
    config.aliases.set(id, name)
  }

  return config
}

/**
 * Quote one scalar when it would otherwise be misread.
 *
 * A value needs quotes when it is empty, has leading or trailing space, contains
 * a `#` that would read as a comment, contains a `:` that would read as a key
 * separator, or would parse as a non-string scalar.
 *
 * @param {string} value - the scalar to emit.
 * @returns {string} the scalar, quoted if needed.
 */
function formatScalar(value) {
  const text = String(value)
  const needsQuotes = text === ''
    || text !== text.trim()
    || /[:#]/.test(text)
    || /^[-?*&!|>%@`{}[\],]/.test(text)
    || /^(true|false|null|yes|no|on|off|~)$/i.test(text)
    || /^-?\d+(\.\d+)?$/.test(text)
  if (!needsQuotes) return text
  // Double quotes with the escapes the reader understands.
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`
}

/**
 * Serialise the config to YAML text.
 *
 * Sorted on purpose: two saves that differ in one switch produce a one-line
 * diff, which is the whole point of putting this in a file.
 *
 * @param {{hidden: Set<string>, aliases: Map<string, string>}} config - the config.
 * @returns {string} YAML text ending in a newline.
 */
export function serializeConfig(config) {
  const hidden = [...(config?.hidden ?? [])].map(String).filter(key => key !== '').sort()
  const aliases = [...(config?.aliases ?? [])]
    .map(([id, name]) => [String(id), String(name ?? '')])
    .filter(([id, name]) => id !== '' && name !== '')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))

  const lines = [
    '# dsh-model-flatmap 插件自有配置',
    '#',
    '# 这个文件归插件自己所有：模型面板的显示开关、Provider 重命名、以及',
    '# 新会话是否默认开启智能体团队协作，都存在这里。',
    '# 可以直接编辑；保存后重启 DSH 生效。设置页的改动也会写回这里。',
    '#',
    '# hidden: 被关掉的 Provider id 或 "provider/model" 路由。没列出的就是显示。',
    '# aliases: Provider id -> 显示名称。删掉一行就恢复目录里的原名。',
  ]

  if (hidden.length === 0) {
    lines.push('hidden: []')
  } else {
    lines.push('hidden:')
    for (const key of hidden) lines.push(`  - ${formatScalar(key)}`)
  }

  if (aliases.length === 0) {
    lines.push('aliases: {}')
  } else {
    lines.push('aliases:')
    for (const [id, name] of aliases) lines.push(`  ${formatScalar(id)}: ${formatScalar(name)}`)
  }

  lines.push('')
  lines.push('# teamDefault: 新会话是否默认开启智能体团队协作。已有会话保存过的选择不受影响。')
  lines.push(`teamDefault: ${config?.teamDefault === true ? 'true' : 'false'}`)

  return `${lines.join('\n')}\n`
}

/**
 * Read the config file.
 *
 * A missing file is the built-in default. A file that exists but does not parse
 * throws, so the caller can warn rather than silently resetting the user's
 * choices.
 *
 * @param {string} path - the config file's path.
 * @returns {{hidden: Set<string>, aliases: Map<string, string>}} the config.
 * @throws {Error} when the file exists and is not this file's shape.
 */
export function readConfigFile(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyConfig()
    throw new Error(`读取 ${path} 失败：${error?.message ?? String(error)}`)
  }
  try {
    return parseConfig(text)
  } catch (error) {
    throw new Error(`${path} 不是合法的配置：${error?.message ?? String(error)}`)
  }
}

/**
 * Write the config file atomically, 0600.
 *
 * Temp file then rename, so a failure mid-write cannot leave a truncated config
 * behind — the old file survives intact.
 *
 * @param {string} path - the config file's path (its directory is created).
 * @param {{hidden: Set<string>, aliases: Map<string, string>}} config - the config.
 * @returns {void}
 */
export function writeConfigFile(path, config) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, serializeConfig(config), { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(tmp, 0o600)
  } catch {
    /* a filesystem without POSIX modes is not a reason to fail the write */
  }
  renameSync(tmp, path)
}
