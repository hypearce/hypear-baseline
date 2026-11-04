import { spawnSync } from 'node:child_process'

const MAX_BUFFER = 64 * 1024 * 1024

/** Runs a program with arguments (no shell). Returns exit code and text output. */
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, ...opts })
  return {
    code: r.status ?? 1,
    out: r.stdout ?? '',
    err: (r.stderr ?? '') + (r.error ? `\n${r.error.message}` : ''),
    timedOut: r.error?.code === 'ETIMEDOUT',
  }
}

/** Runs a shell command line (used for project commands such as `make test`). */
export function runShell(line, cwd, timeoutMs) {
  const started = Date.now()
  const r = spawnSync(line, { cwd, shell: true, encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: timeoutMs })
  return {
    code: r.status ?? 1,
    output: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    timedOut: r.error?.code === 'ETIMEDOUT',
    ms: Date.now() - started,
  }
}

/**
 * Runs a program with an argument array (no shell), so file names are passed
 * verbatim. Same result shape as runShell.
 */
export function runProgram(cmd, args, cwd, timeoutMs, env) {
  const started = Date.now()
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: timeoutMs, env: env ? { ...process.env, ...env } : undefined })
  return {
    code: r.status ?? 1,
    output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error && r.error.code !== 'ETIMEDOUT' ? `\n${r.error.message}` : ''}`,
    timedOut: r.error?.code === 'ETIMEDOUT',
    ms: Date.now() - started,
  }
}

export function git(cwd, ...args) {
  return run('git', args, { cwd })
}

/** Reads a git object as raw bytes, or null if it does not exist. */
export function gitBlob(cwd, spec) {
  const r = spawnSync('git', ['show', spec], { cwd, maxBuffer: MAX_BUFFER })
  return r.status === 0 ? r.stdout : null
}

export function onPath(cmd) {
  const probe = process.platform === 'win32' ? run('where', [cmd]) : run('which', [cmd])
  return probe.code === 0
}
