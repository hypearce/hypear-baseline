#!/usr/bin/env node
// hypear-baseline deterministic review.
//
// Usage: node review.mjs [--base <ref>] [--working] [--full] [--no-project] [--json] [--cwd <dir>]
//   --base <ref>   Compare against this ref (default: upstream, then origin/HEAD, then main/master).
//   --working      Include uncommitted and untracked changes (default: commits only, as a push sends).
//   --full         PR mode: scan all source for Electron rules, run knip and dependency audit, check commits.
//   --no-project   Skip the project's own commands (make test, etc.).
//   --json         Print the report as JSON instead of Markdown.
//
// Exit codes: 0 = pass (warnings possible), 1 = blocking failures, 2 = the review could not run.
import { basename, resolve } from 'node:path'
import { git, runProgram, runShell } from './lib/proc.mjs'
import { collectChanges, resolveScope } from './lib/scope.mjs'
import { otherTools, projectCommands, typescriptTools } from './lib/project.mjs'
import { agnosticChecks } from './checks/agnostic.mjs'
import { commitChecks } from './checks/commits.mjs'
import { electronChecks, usesElectron } from './checks/electron.mjs'
import { portabilityChecks } from './checks/portability.mjs'
import { shellSyntaxChecks } from './checks/shell.mjs'

const COMMAND_TIMEOUT_MS = 10 * 60 * 1000
const OUTPUT_TAIL_LINES = 40
// autofix: mechanical fixes Claude applies without asking; they never block or warn.
const SEVERITY_ORDER = { bug: 0, risk: 1, cleanup: 2, autofix: 3 }
const COMPOSE_FILE = /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/i
const DOCKERFILE = /(^|\/)(Dockerfile|Containerfile)(\.[\w-]+)?$|\.dockerfile$/i
const DOC_ONLY =/\.(md|mdx|txt|rst)$|(^|\/)(LICENSE|CHANGELOG|AUTHORS)[^/]*$/i

function parseArgs(argv) {
  const args = { base: undefined, working: false, full: false, project: true, json: false, cwd: process.cwd() }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') args.base = argv[++i]
    else if (a === '--working') args.working = true
    else if (a === '--full') args.full = true
    else if (a === '--no-project') args.project = false
    else if (a === '--json') args.json = true
    else if (a === '--cwd') args.cwd = resolve(argv[++i])
    else throw new Error(`Unknown option: ${a}`)
  }
  return args
}

function tail(text) {
  const lines = text.trimEnd().split(/\r?\n/)
  return (lines.length > OUTPUT_TAIL_LINES ? ['…', ...lines.slice(-OUTPUT_TAIL_LINES)] : lines).join('\n')
}

/** Display form of a command. Argument-array commands show the program name only. */
function commandText(cmd) {
  if (cmd.line) return cmd.line
  const program = cmd.cmd === process.execPath ? 'node' : basename(cmd.cmd)
  return [program, ...cmd.args].map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')
}

function runCommand(root, cmd) {
  const r = cmd.line ? runShell(cmd.line, root, COMMAND_TIMEOUT_MS) : runProgram(cmd.cmd, cmd.args, cmd.cwd ?? root, COMMAND_TIMEOUT_MS, cmd.env)
  if (cmd.missingCode !== undefined && r.code === cmd.missingCode) return { name: cmd.name, status: 'skipped', note: cmd.missingNote, ms: r.ms }
  const status = r.timedOut ? 'failed' : r.code === 0 ? 'passed' : 'failed'
  return {
    name: cmd.name,
    command: commandText(cmd),
    status,
    severity: status === 'failed' ? (cmd.severity ?? 'bug') : undefined,
    ms: r.ms,
    output: status === 'failed' ? (r.timedOut ? `Timed out after ${COMMAND_TIMEOUT_MS / 60000} minutes.\n` : '') + tail(r.output) : undefined,
  }
}

function review(args) {
  const top = git(args.cwd, 'rev-parse', '--show-toplevel')
  if (top.code !== 0) throw new Error('Not inside a git repository.')
  const root = top.out.trim()

  const scope = resolveScope(root, args)
  const changes = collectChanges(root, scope)
  const report = {
    root,
    scope: { mode: scope.mode, label: scope.label, base: scope.base },
    files: changes.files.length,
    languages: changes.languages,
    checks: [],
    findings: [],
    skipped: [],
  }
  if (changes.files.length === 0) {
    report.result = 'pass'
    report.skipped.push('No changes in scope.')
    return report
  }

  // 1. Agnostic checks (always).
  const agnostic = agnosticChecks(root, changes)
  report.findings.push(...agnostic.findings)
  report.skipped.push(...agnostic.notes)
  report.checks.push({ name: 'agnostic checks (built-in)', status: agnostic.findings.some(f => f.severity === 'bug') ? 'failed' : 'passed' })

  const portability = portabilityChecks(root, scope, changes)
  report.findings.push(...portability)
  report.checks.push({ name: 'portability (built-in: line endings, executable bit, case collisions)', status: portability.some(f => f.severity === 'bug') ? 'failed' : 'passed' })

  const shell = shellSyntaxChecks(changes)
  report.skipped.push(...shell.notes)
  if (shell.ran) {
    report.findings.push(...shell.findings)
    report.checks.push({ name: 'shell syntax (bash -n)', status: shell.findings.length ? 'failed' : 'passed' })
  }

  // Commit hygiene matters for PRs; a pushed work-in-progress branch is normal.
  if (args.full && scope.mode !== 'initial') {
    const commits = commitChecks(root, scope)
    report.findings.push(...commits.findings)
    report.skipped.push(...commits.notes)
    report.checks.push({ name: 'commit hygiene and subjects (built-in)', status: commits.findings.some(f => f.severity !== 'autofix') ? 'failed' : 'passed' })
  }

  const livePaths = changes.live.map(f => f.path)
  const docsOnly = livePaths.every(p => DOC_ONLY.test(p))

  // 2. Electron rules (TypeScript layer, built-in).
  if (changes.languages.includes('typescript') && usesElectron(root)) {
    const targets = args.full
      ? git(root, 'ls-files').out.split('\n').filter(p => /(^|\/)src\//.test(p))
      : livePaths
    const changedSet = new Set(livePaths)
    const found = electronChecks(targets, changes.read).map(f =>
      changedSet.has(f.file) ? f : { ...f, outsideChange: true, message: `(Outside this change.) ${f.message}` })
    report.findings.push(...found)
    report.checks.push({ name: `electron security (built-in, ${args.full ? 'all source' : 'changed files'})`, status: found.some(f => f.severity === 'bug') ? 'failed' : 'passed' })
  }

  // 3. Project commands and installed tools.
  const { commands, pm, alreadyRuns } = projectCommands(root)
  const toRun = []
  if (!args.project) report.skipped.push('Project commands: skipped by request (--no-project).')
  else if (docsOnly) report.skipped.push('Project commands: skipped, documentation-only change.')
  else if (commands.length === 0) report.skipped.push('Project commands: none found (no Makefile check/lint/typecheck/test targets or package.json scripts).')
  else {
    toRun.push(...commands)
    // Project commands run on the files on disk, which only match the commits when the tree is clean.
    const dirty = git(root, 'status', '--porcelain', '--untracked-files=no').out.trim()
    if (scope.mode === 'commits' && dirty) {
      report.warnings = [...(report.warnings ?? []), 'The working tree has uncommitted changes. Project commands and installed tools ran against the files on disk, not the committed state. Commit or stash the changes for an exact result.']
    }
  }

  if (changes.languages.includes('typescript')) {
    const changedScripts = livePaths.filter(p => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(p) && !/(^|\/)(out|dist|node_modules)\//.test(p))
    const ts = typescriptTools(root, pm, alreadyRuns, { changedScripts, full: args.full, commands })
    toRun.push(...ts.tools)
    report.skipped.push(...ts.skipped)
  }
  const other = otherTools(root, pm, {
    changedMarkdown: livePaths.filter(p => /\.(md|mdx)$/i.test(p)),
    changedPowershell: livePaths.filter(p => /\.(ps1|psm1)$/i.test(p)),
    changedShell: shell.files,
    changedCompose: livePaths.filter(p => COMPOSE_FILE.test(p)),
    changedDockerfiles: livePaths.filter(p => DOCKERFILE.test(p)),
    base: scope.base,
  })
  toRun.push(...other.tools)
  report.skipped.push(...other.skipped)

  for (const cmd of toRun) {
    const result = runCommand(root, cmd)
    if (result.status === 'skipped') report.skipped.push(result.note)
    else report.checks.push(result)
  }

  report.findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0))
  const blocking = report.findings.some(f => f.severity === 'bug') || report.checks.some(c => c.status === 'failed' && c.severity === 'bug')
  const warnings = report.findings.some(f => f.severity !== 'autofix') || report.checks.some(c => c.status === 'failed')
  report.result = blocking ? 'fail' : warnings ? 'warn' : 'pass'
  return report
}

function toMarkdown(r) {
  const out = []
  const label = { pass: 'PASS', warn: 'PASS WITH WARNINGS', fail: 'FAIL' }[r.result]
  out.push(`# Deterministic review: ${label}`, '')
  out.push(`- Scope: ${r.scope.label}`, `- Files changed: ${r.files}`, `- Languages: ${r.languages.join(', ') || 'none detected'}`, '')
  for (const w of r.warnings ?? []) out.push(`> **Note:** ${w}`, '')
  if (r.checks.length) {
    out.push('## Checks', '', '| Check | Result | Time |', '|---|---|---|')
    for (const c of r.checks) out.push(`| ${c.name} | ${c.status}${c.status === 'failed' && c.severity && c.severity !== 'bug' ? ` (${c.severity})` : ''} | ${c.ms !== undefined ? `${(c.ms / 1000).toFixed(1)}s` : '-'} |`)
    out.push('')
  }
  const findingLine = f => `- **${f.severity}** \`${f.file}${f.line ? `:${f.line}` : ''}\` [${f.rule}] ${f.message}`
  const findings = r.findings.filter(f => f.severity !== 'autofix')
  const autofixes = r.findings.filter(f => f.severity === 'autofix')
  if (findings.length) out.push('## Findings', '', ...findings.map(findingLine), '')
  if (autofixes.length) out.push('## Auto-fix', '', 'Apply these without asking, rerun the review, and list each one in the review report.', '', ...autofixes.map(findingLine), '')
  for (const c of r.checks.filter(c => c.output)) out.push(`## Output: ${c.name}`, '', '```', c.output, '```', '')
  if (r.skipped.length) {
    out.push('## Not covered', '')
    for (const s of r.skipped) out.push(`- ${s}`)
    out.push('')
  }
  return out.join('\n')
}

try {
  const args = parseArgs(process.argv.slice(2))
  const report = review(args)
  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + '\n' : toMarkdown(report))
  process.exitCode = report.result === 'fail' ? 1 : 0
} catch (e) {
  process.stderr.write(`review could not run: ${e.message}\n`)
  process.exitCode = 2
}
