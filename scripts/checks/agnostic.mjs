// Language-agnostic deterministic checks. Each finding:
// { severity: 'bug' | 'risk' | 'cleanup', rule, file, line?, message }
import { createRequire } from 'node:module'
import { join, posix } from 'node:path'
import { isBinary } from '../lib/scope.mjs'

const LARGE_FILE_BYTES = 1024 * 1024

const SECRET_PATTERNS = [
  { name: 'private key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Stripe secret key', re: /\b[rs]k_live_[0-9A-Za-z]{20,}/ },
  { name: 'hard-coded credential', re: /\b(?:api[_-]?key|secret|passw(?:or)?d|access[_-]?token|auth[_-]?token)\b["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i },
]

const GENERATED_DIRS = /(^|\/)(node_modules|dist|out|build|coverage|\.next|\.vite|\.turbo)\//
const SCRIPT_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i
// Command-line code prints output with console.log by design.
const CLI_FILE = /(^|\/)(cli|bin|scripts|tools)\/|(^|\/)cli\.[cm]?[jt]s$/i
const TEST_FILE = /(\.|\/)(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\/|(^|\/)test_[^/]*\.py$|_test\.py$|(^|\/)tests?\//i
const PY_FILE = /\.py$/i
const CONFIG_FILE = /(^|\/)[^/]*\.config\.[cm]?[jt]s$|\.d\.[cm]?ts$/i
// A test case declaration (JS/TS or Python), used to count tests added and removed.
const TEST_CASE = /^\s*(?:(?:it|test)\b[\w.]*\s*\(|(?:async\s+)?def\s+test_)/
const SKIPPED_TEST = /\b(?:it|test|describe)\.skip\s*\(|\bx(?:it|test|describe)\s*\(|@pytest\.mark\.skip|@unittest\.skip/
const SUPPRESSIONS = [
  { re: /@ts-(?:ignore|nocheck)\b/, what: '`@ts-ignore`/`@ts-nocheck` hides type errors' },
  { re: /@ts-expect-error\b/, what: '`@ts-expect-error` suppresses a type error', allowInTests: true },
  { re: /eslint-disable/, what: '`eslint-disable` turns off lint rules' },
  { re: /\bas\s+any\b/, what: '`as any` discards type checking' },
  { re: /#\s*type:\s*ignore\b/, what: '`# type: ignore` hides type errors' },
  { re: /#\s*noqa\b/, what: '`# noqa` turns off lint rules' },
]
// Files that usually hold credentials. Templates such as .env.example are expected in a repository.
const SENSITIVE_FILES = [
  { re: /(^|\/)\.env(\.(?!(?:example|sample|template|dist|defaults)$)[\w.-]+)?$/i, severity: 'bug', what: 'an environment file' },
  { re: /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$/, severity: 'bug', what: 'an SSH private key' },
  { re: /(^|\/)\.(?:netrc|pgpass)$/, severity: 'bug', what: 'a credentials file' },
  { re: /\.(?:pem|key|p12|pfx|jks|keystore|kdbx)$/i, severity: 'risk', what: 'a key, certificate or password store' },
  { re: /(^|\/)(?:credentials|service-account|client_secret)[^/]*\.json$/i, severity: 'risk', what: 'a credentials file' },
]
const JSONC_FILE = /(^|\/)(tsconfig[^/]*|jsconfig[^/]*|\.vscode\/[^/]+|devcontainer)\.json$/i
const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb', 'bun.lock']
// A "package": "version-spec" pair anywhere on the line. Excludes the package's own version fields.
const DEP_LINE = /"(?!(?:version|packageManager|node|npm|pnpm)")(?:@[\w.-]+\/)?[\w.-]+"\s*:\s*"(?:[\^~<>=*]|\d|workspace:|npm:|file:|link:|github:|git\+|https?:)/

/** Finds keys repeated within one JSON object. JSON.parse keeps only the last silently. */
export function findDuplicateKeys(text) {
  const dups = []
  const stack = []
  let line = 1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\n') { line++; continue }
    if (c === '"') {
      let j = i + 1
      let key = ''
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') { key += text[j] + (text[j + 1] ?? ''); j += 2; continue }
        key += text[j++]
      }
      const top = stack.at(-1)
      if (top?.type === 'object' && top.expectKey) {
        let k = j + 1
        while (k < text.length && /\s/.test(text[k])) k++
        if (text[k] === ':') {
          if (top.keys.has(key)) dups.push({ key, line })
          else top.keys.add(key)
          top.expectKey = false
        }
      }
      i = j
      continue
    }
    if (c === '{') stack.push({ type: 'object', keys: new Set(), expectKey: true })
    else if (c === '[') stack.push({ type: 'array' })
    else if (c === '}' || c === ']') stack.pop()
    else if (c === ',' && stack.at(-1)?.type === 'object') stack.at(-1).expectKey = true
  }
  return dups
}

function loadYaml(root) {
  try {
    return createRequire(join(root, 'package.json'))('yaml')
  } catch {
    return null
  }
}

export function agnosticChecks(root, changes) {
  const findings = []
  const notes = []
  const add = (severity, rule, file, line, message) => findings.push({ severity, rule, file, line, message })

  // Line-level checks on added lines only.
  for (const { file, line, text } of changes.added) {
    if (/^(<{7}|>{7})( |$)|^={7}$/.test(text)) add('bug', 'conflict-marker', file, line, 'Merge-conflict marker left in the file.')
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(text)) { add(p.name === 'hard-coded credential' ? 'risk' : 'bug', 'secret', file, line, `Possible ${p.name}. Remove it from the code and rotate it if it was real.`); break }
    }
    if (SCRIPT_FILE.test(file)) {
      if (/^\s*debugger\s*;?\s*$/.test(text)) add('bug', 'debugger', file, line, '`debugger` statement left in the code.')
      if (TEST_FILE.test(file) && /\b(?:it|test|describe)\.only\s*\(/.test(text)) add('bug', 'focused-test', file, line, '`.only` restricts the test run to this test.')
      if (/\bconsole\.(log|debug)\s*\(/.test(text) && !TEST_FILE.test(file) && !CLI_FILE.test(file)) add('cleanup', 'console-log', file, line, '`console.log` added. Remove it if it is debug output.')
    }
    if (PY_FILE.test(file) && /^\s*print\(/.test(text) && !TEST_FILE.test(file) && !CLI_FILE.test(file)) add('cleanup', 'print-debug', file, line, '`print` added. Remove it if it is debug output; use logging otherwise.')
    if (SCRIPT_FILE.test(file) || PY_FILE.test(file)) {
      for (const s of SUPPRESSIONS) if (s.re.test(text) && !(s.allowInTests && TEST_FILE.test(file))) { add('cleanup', 'suppression', file, line, `${s.what}. Fix the underlying issue, or add a comment explaining why the suppression is needed.`); break }
      if (TEST_FILE.test(file) && SKIPPED_TEST.test(text)) add('risk', 'skipped-test', file, line, 'Test skipped. A skipped test no longer protects the behavior it covers.')
    }
  }

  // File-level checks.
  const yaml = changes.live.some(f => /\.ya?ml$/i.test(f.path)) ? loadYaml(root) : undefined
  if (yaml === null) notes.push('YAML syntax not checked: the `yaml` package is not installed in this project.')

  const treeEntries = withDirectories(changes.tree)
  for (const { path, status } of changes.live) {
    if (GENERATED_DIRS.test(path)) { add('risk', 'generated-file', path, undefined, 'Generated or dependency output is being committed. Add the folder to .gitignore.'); continue }
    const sensitive = SENSITIVE_FILES.find(s => s.re.test(path))
    if (sensitive) add(sensitive.severity, 'sensitive-file', path, undefined, `This looks like ${sensitive.what}. Remove it from the repository, add it to .gitignore, and rotate any secrets it contained. Commit a template (for example .env.example) instead.`)
    const buf = changes.read(path)
    if (!buf) continue
    if (status === 'A' && buf.length > LARGE_FILE_BYTES) add('risk', 'large-file', path, undefined, `Large file added (${(buf.length / 1048576).toFixed(1)} MB). Consider Git LFS or excluding it.`)
    if (isBinary(buf)) {
      if (status === 'A') add('cleanup', 'binary-file', path, undefined, 'Binary file added. Confirm it belongs in the repository.')
      continue
    }
    const text = buf.toString('utf8')
    const crlf = (text.match(/\r\n/g) ?? []).length
    const lf = (text.match(/\n/g) ?? []).length - crlf
    if (crlf > 0 && lf > 0) add('cleanup', 'mixed-line-endings', path, undefined, `Mixed line endings (${crlf} CRLF, ${lf} LF).`)

    if (/\.json$/i.test(path) && !JSONC_FILE.test(path)) {
      try {
        const data = JSON.parse(text.replace(/^﻿/, ''))
        for (const d of findDuplicateKeys(text)) add('risk', 'duplicate-json-key', path, d.line, `Key "${d.key}" appears twice in the same object; only the last value is kept.`)
        for (const id of findDuplicateIds(data)) add('risk', 'duplicate-id', path, lineOfNthId(text, id, 2), `id ${JSON.stringify(id)} appears more than once in the same array.`)
      } catch (e) {
        add('bug', 'invalid-json', path, undefined, `Invalid JSON: ${e.message}`)
      }
    }
    if (/\.mdx?$/i.test(path)) {
      for (const link of brokenLinks(path, text, treeEntries)) add('cleanup', 'broken-link', path, link.line, `Relative link target \`${link.target}\` does not exist.`)
    }
    if (yaml && /\.ya?ml$/i.test(path)) {
      try { yaml.parseAllDocuments(text).forEach(doc => { if (doc.errors.length) throw doc.errors[0] }) }
      catch (e) { add('bug', 'invalid-yaml', path, undefined, `Invalid YAML: ${e.message.split('\n')[0]}`) }
    }
  }

  // Dependency manifest changed without its lockfile.
  const changed = new Set(changes.files.map(f => f.path))
  const lockChanged = [...changed].some(p => LOCKFILES.some(l => p.endsWith(l)))
  if (!lockChanged) {
    const manifests = [...changed].filter(p => /(^|\/)package\.json$/.test(p))
    for (const m of manifests) {
      const touched = [...changes.added, ...changes.removed].some(l => l.file === m && DEP_LINE.test(l.text))
      if (touched) add('risk', 'lockfile-not-updated', m, undefined, 'Dependencies changed but no lockfile changed. Run the package manager install and commit the lockfile.')
    }
  }

  testChecks(changes, add)

  return { findings: collapse(findings), notes }
}

/** Tests removed or deleted, and source changed with no test change. */
function testChecks(changes, add) {
  for (const { path, status } of changes.files) {
    if (status === 'D' && TEST_FILE.test(path) && (SCRIPT_FILE.test(path) || PY_FILE.test(path))) add('risk', 'test-removed', path, undefined, 'Test file deleted. Confirm the behavior it covered is tested elsewhere or no longer exists.')
  }
  const count = lines => {
    const byFile = new Map()
    for (const { file, text } of lines) if (TEST_FILE.test(file) && TEST_CASE.test(text)) byFile.set(file, (byFile.get(file) ?? 0) + 1)
    return byFile
  }
  const added = count(changes.added)
  for (const [file, removed] of count(changes.removed)) {
    const net = removed - (added.get(file) ?? 0)
    if (net > 0) add('risk', 'test-removed', file, undefined, `${net} test case${net > 1 ? 's' : ''} removed (net). Confirm none were removed to make the suite pass.`)
  }

  const isSource = p => (SCRIPT_FILE.test(p) || PY_FILE.test(p)) && !TEST_FILE.test(p) && !CONFIG_FILE.test(p) && !GENERATED_DIRS.test(p)
  const sourceChanged = [...new Set(changes.added.map(l => l.file))].filter(isSource)
  const testsChanged = changes.files.some(f => TEST_FILE.test(f.path))
  const repoHasTests = changes.tree.some(p => TEST_FILE.test(p))
  if (sourceChanged.length && !testsChanged && repoHasTests) {
    add('cleanup', 'no-test-change', sourceChanged[0], undefined, `${sourceChanged.length} source file${sourceChanged.length > 1 ? 's' : ''} changed with no test changes. Confirm new or changed behavior is covered.`)
  }
}

/** Ids repeated among the objects of one array, anywhere in a JSON document. */
export function findDuplicateIds(data) {
  const dups = new Set()
  const walk = node => {
    if (Array.isArray(node)) {
      const seen = new Set()
      for (const item of node) {
        const id = item && typeof item === 'object' && !Array.isArray(item) ? item.id : undefined
        if (typeof id === 'string' || typeof id === 'number') {
          if (seen.has(id)) dups.add(id)
          else seen.add(id)
        }
        walk(item)
      }
    } else if (node && typeof node === 'object') {
      for (const value of Object.values(node)) walk(value)
    }
  }
  walk(data)
  return [...dups]
}

function lineOfNthId(text, id, n) {
  const re = new RegExp(`"id"\\s*:\\s*${JSON.stringify(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g')
  let match
  for (let i = 0; i < n && (match = re.exec(text)); i++) if (i === n - 1) return text.slice(0, match.index).split('\n').length
  return undefined
}

function withDirectories(paths) {
  const entries = new Set(paths)
  for (const p of paths) {
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) entries.add(parts.slice(0, i).join('/'))
  }
  return entries
}

/** Relative links in a Markdown file whose targets are not in the tree under review. */
export function brokenLinks(path, text, entries) {
  const dir = posix.dirname(path)
  const broken = []
  let fence = null
  text.split(/\r?\n/).forEach((raw, i) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(raw)?.[1]
    if (marker && (!fence || marker[0] === fence[0])) { fence = fence ? null : marker; return }
    if (fence) return
    const line = raw.replace(/`[^`]*`/g, '')
    const targets = [...line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g)].map(m => m[1])
    const ref = /^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/.exec(line)
    if (ref) targets.push(ref[1])
    for (const target of targets) {
      if (/^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(target)) continue
      let rel = target.replace(/[?#].*$/, '')
      try { rel = decodeURIComponent(rel) } catch { /* keep the raw target */ }
      if (!rel) continue
      const resolved = posix.normalize(rel.startsWith('/') ? rel.slice(1) : posix.join(dir, rel)).replace(/\/$/, '')
      if (resolved.startsWith('..') || resolved === '.') continue
      if (!entries.has(resolved)) broken.push({ line: i + 1, target })
    }
  })
  return broken
}

function collapse(findings) {
  const groups = new Map()
  for (const f of findings) {
    const key = `${f.severity}|${f.rule}|${f.file}|${f.message}`
    if (!groups.has(key)) groups.set(key, { ...f, lines: [] })
    if (f.line !== undefined) groups.get(key).lines.push(f.line)
  }
  return [...groups.values()].map(({ lines, ...f }) =>
    lines.length > 1 ? { ...f, line: lines[0], message: `${f.message} (${lines.length} places: lines ${lines.slice(0, 8).join(', ')}${lines.length > 8 ? ', …' : ''})` } : f)
}
