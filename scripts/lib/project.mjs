// Discovers the project's own check commands and which optional tools are installed.
import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { onPath, run } from './proc.mjs'

const CHECK_TARGETS = ['check', 'lint', 'typecheck', 'test']
const ENV_TEMPLATES = ['.env.example', '.env.sample', '.env.template']

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

/** Parses Makefile targets and their recipe text. */
function makeTargets(root) {
  const file = join(root, 'Makefile')
  if (!existsSync(file)) return new Map()
  const targets = new Map()
  let current = null
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = /^([A-Za-z][\w.-]*)\s*:(?!=)/.exec(line)
    if (t) { current = t[1]; targets.set(current, ''); continue }
    if (current && line.startsWith('\t')) targets.set(current, targets.get(current) + line + '\n')
    else if (line.trim() && !line.startsWith('#')) current = null
  }
  return targets
}

export function packageManager(root) {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return { name: 'pnpm', run: 'pnpm run', exec: 'pnpm exec', audit: 'pnpm audit --prod' }
  if (existsSync(join(root, 'yarn.lock'))) return { name: 'yarn', run: 'yarn run', exec: 'yarn', audit: 'yarn npm audit --environment production' }
  if (existsSync(join(root, 'package.json'))) return { name: 'npm', run: 'npm run', exec: 'npx --no-install', audit: 'npm audit --omit=dev' }
  return null
}

function hasBin(root, name) {
  return existsSync(join(root, 'node_modules', '.bin', name)) || existsSync(join(root, 'node_modules', '.bin', `${name}.cmd`))
}

function findConfig(root, names) {
  return names.find(n => existsSync(join(root, n)))
}

/**
 * Project commands, in priority order: Makefile targets, then package.json
 * scripts not already covered by a chosen Makefile target.
 */
export function projectCommands(root) {
  const commands = []
  const targets = makeTargets(root)
  const covered = new Set()
  for (const name of CHECK_TARGETS) {
    if (!targets.has(name)) continue
    commands.push({ name: `make ${name}`, line: `make ${name}`, source: 'Makefile', text: targets.get(name) })
    covered.add(name)
    for (const other of CHECK_TARGETS) if (targets.get(name).includes(other)) covered.add(other)
  }
  const pm = packageManager(root)
  const scripts = readJson(join(root, 'package.json'))?.scripts ?? {}
  if (pm) {
    for (const name of CHECK_TARGETS) {
      if (scripts[name] && !covered.has(name)) commands.push({ name: `${pm.name} run ${name}`, line: `${pm.run} ${name}`, source: 'package.json', text: scripts[name] })
    }
  }
  const allText = [...targets.values(), ...Object.values(scripts)].join('\n')
  return { commands, pm, alreadyRuns: tool => allText.includes(tool) }
}


/**
 * Resolves an installed package's bin to an argument-array command, so file
 * names never pass through a shell. Returns null if the package is missing.
 */
export function nodeBin(root, pkg, bin = pkg) {
  const dir = join(root, 'node_modules', pkg)
  const manifest = readJson(join(dir, 'package.json'))
  const rel = typeof manifest?.bin === 'string' ? manifest.bin : manifest?.bin?.[bin]
  if (!rel) return null
  const script = join(dir, rel)
  if (!existsSync(script)) return null
  const firstLine = readFileSync(script, 'utf8').slice(0, 200).split('\n')[0]
  const isNodeScript = /\.[cm]?js$/.test(script) || (firstLine.startsWith('#!') && firstLine.includes('node'))
  return isNodeScript ? { cmd: process.execPath, args: [script] } : { cmd: script, args: [] }
}

/** True if a discovered project command already type-checks the code. */
function typecheckCovered(commands) {
  return commands.some(c => /\b(typecheck|check)$/.test(c.name) || /\b(typecheck|tsc|vue-tsc)\b/.test(c.text ?? ''))
}

/** Solution-style tsconfigs (`"files": []` plus references) check nothing with `tsc -p`. */
function isSolutionConfig(text) {
  return /"references"\s*:/.test(text) && /"files"\s*:\s*\[\s*\]/.test(text)
}

/** Optional tools for the TypeScript layer, if the project has them installed. */
export function typescriptTools(root, pm, alreadyRuns, { changedScripts, full, commands }) {
  const tools = []
  const skipped = []
  if (!pm) return { tools, skipped }

  const eslintConfig = findConfig(root, ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs'])
  const eslint = nodeBin(root, 'eslint')
  if (!eslint || !eslintConfig) skipped.push('ESLint: not installed or no config. Run /review-setup to add it.')
  else if (alreadyRuns('eslint')) skipped.push('ESLint: already run by a project command.')
  else if (changedScripts.length) {
    tools.push({ name: 'eslint (changed files)', cmd: eslint.cmd, args: [...eslint.args, '--no-warn-ignored', ...changedScripts] })
  }

  if (existsSync(join(root, 'tsconfig.json')) && changedScripts.length && !typecheckCovered(commands)) {
    const tsc = nodeBin(root, 'typescript', 'tsc')
    if (!tsc) skipped.push('tsc: tsconfig.json found but TypeScript is not installed.')
    else if (isSolutionConfig(readFileSync(join(root, 'tsconfig.json'), 'utf8'))) skipped.push('tsc: solution-style tsconfig.json and no typecheck script. Add a `typecheck` script that checks each referenced project.')
    else tools.push({ name: 'tsc --noEmit (no typecheck script found)', cmd: tsc.cmd, args: [...tsc.args, '--noEmit', '-p', 'tsconfig.json'] })
  }

  if (!hasBin(root, 'knip')) skipped.push('knip: not installed.')
  else if (!full) skipped.push('knip: runs in full (PR) reviews only.')
  else if (!alreadyRuns('knip')) tools.push({ name: 'knip', line: `${pm.exec} knip` })

  const cruiserConfig = findConfig(root, ['.dependency-cruiser.cjs', '.dependency-cruiser.js', '.dependency-cruiser.json', '.dependency-cruiser.mjs'])
  if (!hasBin(root, 'depcruise') || !cruiserConfig) skipped.push('dependency-cruiser: not installed or no config.')
  else if (!alreadyRuns('depcruise')) {
    const dirs = ['src', 'apps', 'packages', 'lib'].filter(d => existsSync(join(root, d)))
    if (dirs.length) tools.push({ name: 'dependency-cruiser', line: `${pm.exec} depcruise --config ${cruiserConfig} ${dirs.join(' ')}` })
  }

  if (full) tools.push({ name: `${pm.name} audit`, line: pm.audit, severity: 'risk' })
  else skipped.push(`${pm.name} audit: runs in full (PR) reviews only (needs network).`)

  return { tools, skipped }
}

// PowerShell reads the paths from the environment, so no file name is ever parsed as script text.
const PS_ANALYZER = [
  'if (-not (Get-Module -ListAvailable PSScriptAnalyzer)) { exit 3 }',
  '$r = $env:HYPEAR_REVIEW_PATHS -split [char]10 | ForEach-Object { Invoke-ScriptAnalyzer -Path $_ -Severity Error,Warning }',
  '$r | Format-Table -AutoSize | Out-String -Width 200',
  'if ($r) { exit 1 }',
].join('; ')

export function otherTools(root, pm, { changedMarkdown, changedPowershell, changedShell, changedCompose, changedDockerfiles, base }) {
  const tools = []
  const skipped = []
  if (onPath('gitleaks')) {
    const opts = base ? ` --log-opts="${base}..HEAD"` : ''
    tools.push({ name: 'gitleaks', line: `gitleaks detect --no-banner --redact --source .${opts}` })
  } else {
    skipped.push('gitleaks: not installed; using the built-in secret patterns only.')
  }

  if (changedMarkdown.length) {
    const mdlint = pm ? nodeBin(root, 'markdownlint-cli2') : null
    if (mdlint) tools.push({ name: 'markdownlint', cmd: mdlint.cmd, args: [...mdlint.args, ...changedMarkdown], severity: 'cleanup' })
    else skipped.push('markdownlint: not installed.')
  }

  if (changedPowershell.length) {
    const ps = process.platform === 'win32' ? 'powershell' : 'pwsh'
    if (!onPath(ps)) skipped.push('PSScriptAnalyzer: PowerShell is not installed.')
    else tools.push({ name: 'PSScriptAnalyzer', cmd: ps, args: ['-NoProfile', '-Command', PS_ANALYZER], env: { HYPEAR_REVIEW_PATHS: changedPowershell.join('\n') }, severity: 'risk', missingCode: 3, missingNote: 'PSScriptAnalyzer: module not installed (Install-Module PSScriptAnalyzer).' })
  }

  if (changedShell.length) {
    if (onPath('shellcheck')) tools.push({ name: 'shellcheck', cmd: 'shellcheck', args: ['-f', 'gcc', ...changedShell], severity: 'risk' })
    else skipped.push('shellcheck: not installed (winget install koalaman.shellcheck); bash -n syntax check only.')
  }

  if (changedCompose.length) {
    if (!onPath('docker') || run('docker', ['compose', 'version']).code !== 0) skipped.push('Compose validation: Docker Compose is not installed.')
    else for (const file of changedCompose) {
      // .env is per-machine and usually absent from a dev checkout; the committed template stands in for it.
      const dir = posix.dirname(file)
      const example = existsSync(join(root, dir, '.env')) ? null : ENV_TEMPLATES.map(n => posix.join(dir, n)).find(p => existsSync(join(root, p)))
      tools.push({
        name: `docker compose config (${file}${example ? `, with ${posix.basename(example)}` : ''})`,
        cmd: 'docker',
        args: ['compose', '-f', file, ...(example ? ['--env-file', example] : []), 'config', '-q'],
        severity: 'risk',
      })
    }
  }

  if (changedDockerfiles.length) {
    if (onPath('hadolint')) tools.push({ name: 'hadolint', cmd: 'hadolint', args: changedDockerfiles, severity: 'risk' })
    else skipped.push('hadolint: not installed.')
  }

  return { tools, skipped }
}
