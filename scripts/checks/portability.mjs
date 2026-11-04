// Checks for files edited on Windows and run on Linux (or the reverse):
// CRLF in files Linux tools reject, scripts missing the executable bit, and
// paths that collide on case-insensitive file systems.
import { git } from '../lib/proc.mjs'
import { isBinary } from '../lib/scope.mjs'
import { isShellScript } from './shell.mjs'

// bash and make both fail on CR characters.
const LF_ONLY = /\.(sh|bash|mk)$|(^|\/)(GNUmakefile|[Mm]akefile)$|(^|\/)(Dockerfile|Containerfile)[^/]*$/

/**
 * True if git converts CRLF to LF when this path is committed, so CRLF in the
 * working tree never reaches the repository.
 */
function normalizedOnCommit(root, path) {
  const attr = git(root, 'check-attr', 'text', '--', path).out.trim().split(': ').at(-1)
  if (attr === 'set' || attr === 'auto') return true
  if (attr === 'unset') return false
  return ['true', 'input'].includes(git(root, 'config', '--get', 'core.autocrlf').out.trim().toLowerCase())
}

/** Git file modes for the given paths in the state under review. */
function fileModes(root, scope, paths) {
  const listing = scope.mode === 'commits'
    ? git(root, 'ls-tree', '-z', 'HEAD', '--', ...paths).out
    : git(root, 'ls-files', '-z', '-s', '--', ...paths).out
  const modes = new Map()
  for (const entry of listing.split('\0').filter(Boolean)) {
    const [meta, path] = entry.split('\t')
    modes.set(path, meta.split(' ')[0])
  }
  return modes
}

/** Groups of paths (or directory prefixes) that differ only by letter case. */
export function caseCollisions(paths) {
  const variants = new Map()
  for (const path of paths) {
    const parts = path.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/')
      const key = prefix.toLowerCase()
      if (!variants.has(key)) variants.set(key, new Set())
      variants.get(key).add(prefix)
    }
  }
  const groups = [...variants.values()].filter(s => s.size > 1).map(s => [...s].sort())
  // Report only the shallowest collision; deeper paths under it collide as a consequence.
  return groups.filter(g => !groups.some(o => o !== g && g[0].toLowerCase().startsWith(`${o[0].toLowerCase()}/`)))
}

export function portabilityChecks(root, scope, changes) {
  const findings = []
  const scripts = []

  for (const { path } of changes.live) {
    const buf = changes.read(path)
    if (!buf || isBinary(buf)) continue
    const shell = isShellScript(path, buf)
    if (shell && buf.subarray(0, 2).toString() === '#!') scripts.push(path)
    if (!(shell || LF_ONLY.test(path)) || !buf.includes('\r\n')) continue
    if (scope.mode !== 'commits' && normalizedOnCommit(root, path)) continue
    findings.push({ severity: 'bug', rule: 'crlf-line-endings', file: path, message: 'CRLF line endings; bash and make fail on the carriage returns on Linux. Convert to LF and add `*.sh text eol=lf` (and similar) to .gitattributes.' })
  }

  if (scripts.length) {
    const modes = fileModes(root, scope, scripts)
    for (const path of scripts) {
      const mode = modes.get(path)
      if (mode && mode !== '100755') findings.push({ severity: 'risk', rule: 'not-executable', file: path, message: `Script has a shebang but is not executable in git (mode ${mode}); it will fail with "Permission denied" when run directly on Linux. Fix: \`git update-index --chmod=+x ${path}\`.` })
    }
  }

  const changed = changes.live.map(f => f.path.toLowerCase())
  for (const group of caseCollisions(changes.tree)) {
    const key = group[0].toLowerCase()
    if (!changed.some(p => p === key || p.startsWith(`${key}/`))) continue
    findings.push({ severity: 'bug', rule: 'case-collision', file: group[0], message: `Paths differ only by letter case (${group.join(', ')}). They are distinct on Linux but collide on Windows and macOS. Rename one.` })
  }
  return findings
}
