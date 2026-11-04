// Shared state and checks for scripts/changelog.mjs and scripts/release.mjs.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkRequested, latestRelease, lintChangelog, nextVersion, parseChangelog,
  parseSemver, releaseChangelog, sectionNotes, unreleasedSection,
} from './changelog.mjs'
import { findDeclarations, writeDeclarations } from './versions.mjs'
import { git, run } from './proc.mjs'

export const CHANGELOG = 'CHANGELOG.md'
export const RELEASE_BRANCH = 'main'
export const tagFor = version => `v${version}`

export function repoRoot(cwd) {
  const r = git(cwd, 'rev-parse', '--show-toplevel')
  return r.code === 0 ? r.out.trim() : null
}

export function localDate(d = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Everything the changelog and release commands need to know about the repository. */
export function changelogState(root) {
  const path = join(root, CHANGELOG)
  const declarations = findDeclarations(root)
  if (!existsSync(path)) return { exists: false, path, declarations }
  const text = readFileSync(path, 'utf8')
  const parsed = parseChangelog(text)
  const latest = latestRelease(parsed)?.version ?? null
  const unreleased = unreleasedSection(parsed)
  const entries = Object.values(unreleased?.groups ?? {}).reduce((n, g) => n + g.length, 0)
  return {
    exists: true,
    path,
    text,
    parsed,
    lint: lintChangelog(text),
    latest,
    entries,
    next: nextVersion(latest, unreleased?.groups ?? {}),
    declarations,
    mismatched: latest ? declarations.filter(d => d.version !== latest) : [],
  }
}

/** GitHub owner/repo from the configured origin URL (not insteadOf-expanded). */
export function githubRepo(root) {
  const url = git(root, 'config', '--get', 'remote.origin.url').out.trim()
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url)
  return m ? `${m[1]}/${m[2]}` : null
}

/** The GitHub CLI. HYPEAR_RELEASE_GH substitutes a stand-in (used by the tests). */
export function gh(root, args) {
  const override = process.env.HYPEAR_RELEASE_GH
  if (override && /\.m?js$/.test(override)) return run(process.execPath, [override, ...args], { cwd: root })
  return run(override || 'gh', args, { cwd: root })
}

/**
 * Checks that a release can proceed. mode "release": cut `version` (default:
 * the computed next version) from Unreleased. mode "publish": create the
 * GitHub release for `version`, already committed and pushed.
 */
export function preflight(root, { mode = 'release', version } = {}) {
  const checks = []
  const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); return Boolean(ok) }
  const state = changelogState(root)

  const branch = git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD').out.trim()
  check(`on ${RELEASE_BRANCH}`, branch === RELEASE_BRANCH, branch ? `current branch is ${branch}` : 'detached HEAD')
  // Uncommitted CHANGELOG.md edits are allowed: they become part of the release commit.
  const dirty = git(root, 'status', '--porcelain', '--untracked-files=no').out.split('\n').filter(l => l && l.slice(3) !== CHANGELOG)
  check(`no uncommitted changes other than ${CHANGELOG}`, !dirty.length, dirty.slice(0, 5).join('; '))

  const tracked = state.exists && git(root, 'ls-files', '--error-unmatch', CHANGELOG).code === 0
  check(`${CHANGELOG} is committed`, tracked, state.exists ? 'not tracked by git' : 'missing; create it with "changelog.mjs init"')
  if (state.exists) check(`${CHANGELOG} format`, !state.lint.length, state.lint.slice(0, 5).map(f => `line ${f.line}: ${f.message}`).join('; '))

  const repo = githubRepo(root)
  check('origin is a GitHub repository', repo, 'set origin to a github.com URL')
  const fetched = git(root, 'fetch', '--quiet', 'origin', RELEASE_BRANCH)
  const head = git(root, 'rev-parse', 'HEAD').out.trim()
  const remote = git(root, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${RELEASE_BRANCH}`).out.trim()
  check(`in sync with origin/${RELEASE_BRANCH}`, fetched.code === 0 && head && head === remote,
    fetched.code !== 0 ? `fetch failed: ${fetched.err.trim()}` : `HEAD ${head.slice(0, 7)} differs from origin/${RELEASE_BRANCH} ${remote.slice(0, 7) || '(missing)'}; pull or push first`)

  const auth = gh(root, ['auth', 'status', '--hostname', 'github.com'])
  const ghOk = check('GitHub CLI installed and signed in', auth.code === 0,
    /ENOENT|not recognized|not found/.test(auth.err) ? 'gh not found; install it (winget install GitHub.cli) and run gh auth login' : auth.err.trim().split('\n')[0])

  let target = version ?? null
  if (state.exists && mode === 'release') {
    check('Unreleased has entries', state.entries > 0, 'nothing to release')
    target = version ?? state.next.version
    const problem = target ? checkRequested(state.latest, target, state.next.version) : state.next.reason
    check(`version ${target ?? '(unknown)'} follows the versioning rules`, !problem, problem ?? '')
    check(`version declarations match the last release (${state.latest ?? 'none yet'})`, !state.mismatched.length,
      state.mismatched.map(d => `${d.file} ${d.where} = ${d.version}`).join('; '))
  }
  if (state.exists && mode === 'publish') {
    check('version given', target, 'pass --version')
    const subject = git(root, 'log', '-1', '--format=%s', 'HEAD').out.trim()
    check(`HEAD is the release commit for ${target}`, target && subject === `Release ${tagFor(target)}`, `HEAD is "${subject}"`)
    check(`${target} is the latest changelog release`, target && state.latest === target, `latest is ${state.latest ?? 'none'}`)
    const off = state.declarations.filter(d => d.version !== target)
    check('version declarations match', !off.length, off.map(d => `${d.file} ${d.where} = ${d.version}`).join('; '))
  }

  if (target && parseSemver(target)) {
    const tag = tagFor(target)
    const local = git(root, 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}`).code === 0
    const remoteTag = git(root, 'ls-remote', '--tags', 'origin', `refs/tags/${tag}`)
    check(`tag ${tag} does not exist`, !local && remoteTag.code === 0 && !remoteTag.out.trim(),
      local ? 'exists locally' : remoteTag.code !== 0 ? `could not query origin: ${remoteTag.err.trim().split('\n')[0]}` : 'exists on origin')
    if (ghOk && repo) check(`no GitHub release ${tag}`, gh(root, ['release', 'view', tag, '--repo', repo]).code !== 0, 'already exists')
  }

  return { ok: checks.every(c => c.ok), checks, state, version: target, repo, head }
}

/** Files the release commit may change: the changelog and the version declarations. */
export const releaseFiles = state => [CHANGELOG, ...new Set(state.declarations.map(d => d.file))]

/** Writes the release into the changelog and version declarations; returns the files written. */
export function applyRelease(root, state, version, repo, date = localDate()) {
  const text = releaseChangelog(state.text, version, date, `https://github.com/${repo}`)
  const findings = lintChangelog(text)
  if (findings.length) throw new Error(`the released changelog would not lint: ${findings.map(f => `line ${f.line}: ${f.message}`).join('; ')}`)
  writeFileSync(state.path, text)
  writeDeclarations(root, state.declarations, version)
  return releaseFiles(state)
}

/** Creates the GitHub release (and tag) at `sha` with the changelog section as notes. */
export function publishRelease(root, { version, repo, sha }) {
  const notes = sectionNotes(readFileSync(join(root, CHANGELOG), 'utf8'), version)
  const dir = mkdtempSync(join(tmpdir(), 'hypear-release-'))
  try {
    const notesFile = join(dir, 'notes.md')
    writeFileSync(notesFile, `${notes}\n`)
    const tag = tagFor(version)
    const args = ['release', 'create', tag, '--repo', repo, '--target', sha, '--title', tag, '--notes-file', notesFile]
    if (parseSemver(version).pre.length) args.push('--prerelease')
    const r = gh(root, args)
    if (r.code !== 0) return { ok: false, error: (r.err || r.out).trim() }
    git(root, 'fetch', '--quiet', 'origin', `refs/tags/${tag}:refs/tags/${tag}`)
    return { ok: true, url: r.out.trim().split('\n').at(-1) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
