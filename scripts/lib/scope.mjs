// Works out what is being reviewed: the commit range, the changed files,
// the added and removed lines, and the languages involved.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, gitBlob } from './proc.mjs'

const LANGUAGES = [
  { id: 'typescript', test: /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i },
  { id: 'json', test: /\.json$/i },
  { id: 'yaml', test: /\.ya?ml$/i },
  { id: 'markdown', test: /\.(md|mdx)$/i },
  { id: 'css', test: /\.(css|scss)$/i },
  { id: 'powershell', test: /\.(ps1|psm1|psd1)$/i },
  { id: 'python', test: /\.py$/i },
  { id: 'shell', test: /\.(sh|bash)$/i },
  { id: 'docker', test: /(^|\/)(Dockerfile|Containerfile)[^/]*$|\.dockerfile$|(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/i },
]

export function languageOf(path) {
  return LANGUAGES.find(l => l.test.test(path))?.id ?? 'other'
}

function verify(root, ref) {
  return git(root, 'rev-parse', '--verify', '-q', `${ref}^{commit}`).code === 0
}

/**
 * Resolves the review range.
 * mode "initial":  repository has no commits; every file counts as added.
 * mode "commits":  merge-base(baseRef, HEAD)..HEAD (what a push or PR sends).
 * mode "working":  merge-base(baseRef, HEAD)..working tree, plus untracked files.
 */
export function resolveScope(root, { base, working }) {
  if (!verify(root, 'HEAD')) {
    return { mode: 'initial', baseRef: null, base: null, label: 'no commits yet: all files in the working tree' }
  }
  const branch = git(root, 'rev-parse', '--abbrev-ref', 'HEAD').out.trim()
  let baseRef = base
  if (!baseRef) {
    const upstream = git(root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
    if (upstream.code === 0) baseRef = upstream.out.trim()
  }
  if (!baseRef) {
    const originHead = git(root, 'symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD')
    if (originHead.code === 0) baseRef = originHead.out.trim()
  }
  if (!baseRef) {
    baseRef = ['origin/main', 'origin/master', 'main', 'master'].find(r => r !== branch && verify(root, r))
  }
  if (!baseRef || !verify(root, baseRef)) {
    if (base) throw new Error(`Base ref "${base}" does not exist.`)
    // No remote or base branch: review the last commit, plus the working tree if asked.
    const parent = verify(root, 'HEAD~1') ? 'HEAD~1' : null
    if (!parent) return { mode: 'initial', baseRef: null, base: null, label: 'single commit with no base: all files' }
    return { mode: working ? 'working' : 'commits', baseRef: 'HEAD~1', base: git(root, 'rev-parse', 'HEAD~1').out.trim(), label: 'no base branch found: last commit only' }
  }
  const mb = git(root, 'merge-base', baseRef, 'HEAD')
  if (mb.code !== 0) throw new Error(`No common history between ${baseRef} and HEAD.`)
  return {
    mode: working ? 'working' : 'commits',
    baseRef,
    base: mb.out.trim(),
    label: working ? `${baseRef}...working tree (committed and uncommitted changes)` : `${baseRef}..HEAD`,
  }
}

function parseNameStatus(text) {
  const files = []
  for (const row of text.split('\n')) {
    if (!row.trim()) continue
    const [status, a, b] = row.split('\t')
    const path = status.startsWith('R') || status.startsWith('C') ? b : a
    files.push({ path, status: status[0] })
  }
  return files
}

/** Parses `git diff -U0` output into added and removed lines per file. */
function parseDiff(text) {
  const added = []
  const removed = []
  let file = null
  let line = 0
  for (const row of text.split('\n')) {
    if (row.startsWith('+++ ')) { file = row === '+++ /dev/null' ? null : row.slice(6); continue }
    if (row.startsWith('--- ')) continue
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row)
    if (hunk) { line = Number(hunk[1]); continue }
    if (!file) continue
    if (row.startsWith('+')) { added.push({ file, line, text: row.slice(1) }); line++ }
    else if (row.startsWith('-')) removed.push({ file, text: row.slice(1) })
  }
  return { added, removed }
}

export function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0)
}

/** Every file path in the state under review: HEAD for commit ranges, otherwise the working tree. */
function treePaths(root, scope) {
  const listing = scope.mode === 'commits'
    ? git(root, 'ls-tree', '-r', '-z', '--name-only', 'HEAD')
    : git(root, 'ls-files', '-z', '-co', '--exclude-standard')
  return [...new Set(listing.out.split('\0').filter(Boolean))]
}

/** Collects changed files, line changes and a content reader for the scope. */
export function collectChanges(root, scope) {
  let files = []
  let added = []
  let removed = []

  const readWorktree = path => {
    const full = join(root, path)
    return existsSync(full) ? readFileSync(full) : null
  }
  const read = scope.mode === 'commits' ? path => gitBlob(root, `HEAD:${path}`) : readWorktree

  const addWholeFile = path => {
    const buf = read(path)
    if (!buf || isBinary(buf)) return
    buf.toString('utf8').split(/\r?\n/).forEach((text, i) => added.push({ file: path, line: i + 1, text }))
  }

  if (scope.mode === 'initial') {
    const list = git(root, 'ls-files', '-co', '--exclude-standard').out.split('\n').filter(Boolean)
    files = [...new Set(list)].map(path => ({ path, status: 'A' }))
    files.forEach(f => addWholeFile(f.path))
  } else {
    const range = scope.mode === 'commits' ? [scope.base, 'HEAD'] : [scope.base]
    files = parseNameStatus(git(root, 'diff', '--name-status', '-M', ...range).out)
    ;({ added, removed } = parseDiff(git(root, 'diff', '-U0', '--no-color', '--no-ext-diff', ...range).out))
    if (scope.mode === 'working') {
      const untracked = git(root, 'ls-files', '-o', '--exclude-standard').out.split('\n').filter(Boolean)
      for (const path of untracked) {
        files.push({ path, status: 'A' })
        addWholeFile(path)
      }
    }
  }

  const live = files.filter(f => f.status !== 'D')
  const languages = [...new Set(live.map(f => languageOf(f.path)))].filter(l => l !== 'other').sort()
  return { files, live, added, removed, languages, read, tree: treePaths(root, scope) }
}
