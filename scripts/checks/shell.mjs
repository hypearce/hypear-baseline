// Shell script syntax check with `bash -n`. Content is passed on stdin, so the
// check reads the state under review and never needs a path translation.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isBinary } from '../lib/scope.mjs'
import { onPath, run } from '../lib/proc.mjs'

const SHELL_EXT = /\.(sh|bash)$/i
const NO_EXT = /(^|\/)[^/.]+$/
const SHELL_SHEBANG = /^#!\s*\/(?:usr\/)?bin\/(?:env\s+)?(?:ba)?sh\b/

/** A .sh/.bash file, or an extensionless file with a sh/bash shebang. */
export function isShellScript(path, buf) {
  if (SHELL_EXT.test(path)) return true
  return NO_EXT.test(path) && !!buf && !isBinary(buf) && SHELL_SHEBANG.test(buf.subarray(0, 200).toString('utf8'))
}

/**
 * On Windows, `bash` on PATH is usually the WSL launcher, which fails without a
 * distribution. Git for Windows ships a bash next to git; prefer that.
 */
function findBash() {
  if (process.platform !== 'win32') return onPath('bash') ? 'bash' : null
  for (const gitExe of run('where', ['git']).out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
    let dir = dirname(gitExe)
    for (let depth = 0; depth < 3; depth++, dir = dirname(dir)) {
      for (const candidate of [join(dir, 'bin', 'bash.exe'), join(dir, 'usr', 'bin', 'bash.exe')]) {
        if (existsSync(candidate)) return candidate
      }
    }
  }
  return null
}

export function shellSyntaxChecks(changes) {
  const files = changes.live.map(f => f.path).filter(p => isShellScript(p, changes.read(p)))
  if (!files.length) return { ran: false, files, findings: [], notes: [] }
  const bash = findBash()
  if (!bash) return { ran: false, files, findings: [], notes: ['Shell syntax: bash not found (install Git for Windows on Windows).'] }

  const findings = []
  for (const path of files) {
    const buf = changes.read(path)
    if (!buf) continue
    // Line endings are reported by the portability check; strip them so the syntax result is about syntax.
    const text = buf.toString('utf8').replace(/\r\n/g, '\n')
    const r = spawnSync(bash, ['-n'], { input: text, encoding: 'utf8' })
    if (r.status === 0) continue
    const error = (r.stderr ?? '').split('\n').find(l => /line \d+:/.test(l)) ?? r.stderr?.trim() ?? 'bash -n failed'
    const line = Number(/line (\d+):/.exec(error)?.[1]) || undefined
    findings.push({ severity: 'bug', rule: 'shell-syntax', file: path, line, message: `Shell syntax error: ${error.replace(/^.*?line \d+:\s*/, '')}` })
  }
  return { ran: true, files, findings, notes: [] }
}
