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

/** True if commit `a` is reachable from `b`; null if git could not tell. */
function isAncestor(root, a, b) {
  const r = git(root, 'merge-base', '--is-ancestor', a, b)
  return r.code === 0 ? true : r.code === 1 ? false : null
}

const REMOTE_REF = `refs/remotes/origin/${RELEASE_BRANCH}`
const LOCAL_REF = `refs/heads/${RELEASE_BRANCH}`

/**
 * Whether the repository can be moved onto an up-to-date main without losing
 * or carrying over work: no uncommitted changes to tracked files, HEAD fully
 * merged into origin/main, and local main (if any) a fast-forward of it and
 * not checked out in another worktree. Squash and rebase merges leave HEAD
 * unmerged by this test, so they are not treated as safe. Untracked files
 * are not checked; git refuses the switch if one would be overwritten.
 * Reads refs only; call after fetching origin/main.
 */
export function syncState(root) {
  const branch = git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD').out.trim()
  const head = git(root, 'rev-parse', 'HEAD').out.trim()
  const remote = git(root, 'rev-parse', '--verify', '--quiet', REMOTE_REF).out.trim()
  if (!remote) return { needed: true, safe: false, branch, problems: [`origin/${RELEASE_BRANCH} not found`] }
  if (branch === RELEASE_BRANCH && head === remote) return { needed: false, safe: true, branch, problems: [] }

  const problems = []
  const unmerged = (ref, label) => {
    const merged = isAncestor(root, ref, REMOTE_REF)
    if (merged === null) problems.push(`could not compare ${label} with origin/${RELEASE_BRANCH}`)
    else if (!merged) problems.push(`${label} has commits that are not in origin/${RELEASE_BRANCH}`)
  }
  const dirty = git(root, 'status', '--porcelain', '--untracked-files=no').out.split('\n').filter(Boolean)
  if (dirty.length) problems.push(`uncommitted changes: ${dirty.slice(0, 5).map(l => l.slice(3)).join(', ')}`)
  unmerged('HEAD', branch || 'detached HEAD')
  const mainSha = git(root, 'rev-parse', '--verify', '--quiet', LOCAL_REF).out.trim()
  if (mainSha && branch !== RELEASE_BRANCH) {
    unmerged(LOCAL_REF, `local ${RELEASE_BRANCH}`)
    // HEAD is not on main here, so any worktree on main is another one.
    const worktrees = git(root, 'worktree', 'list', '--porcelain').out.split('\n')
    if (worktrees.includes(`branch ${LOCAL_REF}`)) problems.push(`${RELEASE_BRANCH} is checked out in another worktree`)
  }
  return { needed: true, safe: !problems.length, branch, mainSha, problems }
}

/**
 * Moves the repository onto main at origin/main, only in the state syncState
 * calls safe. Fetches first. All or nothing: off main, it fast-forwards the
 * main ref, then switches in one step, and puts the ref back if the switch
 * fails. Returns { ok, changed, message, error? }.
 */
export function prepareRelease(root) {
  const fail = (message, error) => ({ ok: false, changed: false, message, error })
  const fetched = git(root, 'fetch', '--quiet', 'origin', RELEASE_BRANCH)
  if (fetched.code !== 0) return fail(`Fetch failed: ${fetched.err.trim()}`, 'fetch failed')
  const sync = syncState(root)
  if (!sync.needed) return { ok: true, changed: false, message: `Already on ${RELEASE_BRANCH} and in sync with origin/${RELEASE_BRANCH}.` }
  if (!sync.safe) return fail(`Not switching: ${sync.problems.join('; ')}. Nothing was changed.`, 'not safe')
  const remote = git(root, 'rev-parse', REMOTE_REF).out.trim()

  if (sync.branch === RELEASE_BRANCH) {
    const ff = git(root, 'merge', '--ff-only', '--quiet', REMOTE_REF)
    if (ff.code !== 0) return fail(`Fast-forward failed: ${ff.err.trim()}. Nothing was changed.`, 'fast-forward failed')
    return { ok: true, changed: true, message: `Fast-forwarded ${RELEASE_BRANCH} to origin/${RELEASE_BRANCH} (${remote.slice(0, 7)}).` }
  }

  const moved = sync.mainSha
    ? git(root, 'update-ref', '-m', 'release.mjs prepare: fast-forward', LOCAL_REF, remote, sync.mainSha)
    : git(root, 'branch', '--quiet', '--track', RELEASE_BRANCH, REMOTE_REF)
  if (moved.code !== 0) return fail(`Could not update ${RELEASE_BRANCH}: ${moved.err.trim()}. Nothing was changed.`, 'update failed')
  const sw = git(root, 'switch', '--quiet', RELEASE_BRANCH)
  if (sw.code !== 0) {
    const undo = sync.mainSha
      ? git(root, 'update-ref', LOCAL_REF, sync.mainSha, remote)
      : git(root, 'branch', '--quiet', '-D', RELEASE_BRANCH)
    const state = undo.code === 0 ? 'Nothing was changed.' : `Local ${RELEASE_BRANCH} was left at origin/${RELEASE_BRANCH}; no work was lost.`
    return fail(`git switch failed: ${sw.err.trim()}. ${state}`, 'switch failed')
  }
  const from = sync.branch ? `branch ${sync.branch}` : 'detached HEAD'
  const kept = sync.branch ? ` ${sync.branch} is fully merged and was kept.` : ''
  return { ok: true, changed: true, message: `Switched from ${from} to ${RELEASE_BRANCH} at origin/${RELEASE_BRANCH} (${remote.slice(0, 7)}).${kept}` }
}

// Ruleset rule types that reject a direct push of the release commit. Rules on
// commit message or author patterns are not evaluated.
const PUSH_BLOCKING_RULES = new Set(['pull_request', 'required_status_checks', 'required_deployments', 'merge_queue', 'update'])

/**
 * Rulesets on main that would reject the direct push of the release commit
 * for the signed-in user (GitHub error GH013). Classic branch protection is
 * not checked. Returns { ok, detail } or, when the rules cannot be read at
 * all, { ok: true, warning }, so an unavailable API does not block releases.
 */
export function pushRuleBlockers(root, repo) {
  const rules = gh(root, ['api', `repos/${repo}/rules/branches/${RELEASE_BRANCH}?per_page=100`])
  let list = null
  if (rules.code === 0) { try { list = JSON.parse(rules.out) } catch { list = null } }
  if (!Array.isArray(list)) {
    const why = rules.code !== 0 ? rules.err.trim().split('\n')[0] : 'unexpected response'
    return { ok: true, detail: '', warning: `could not read the rules for ${RELEASE_BRANCH} (${why}); a ruleset may still reject the release push` }
  }
  const signs = git(root, 'config', '--bool', 'commit.gpgsign').out.trim() === 'true'
  const byRuleset = new Map()
  for (const rule of list) {
    if (typeof rule?.type !== 'string' || rule.ruleset_id == null) continue
    if (!PUSH_BLOCKING_RULES.has(rule.type) && !(rule.type === 'required_signatures' && !signs)) continue
    byRuleset.set(rule.ruleset_id, [...(byRuleset.get(rule.ruleset_id) ?? []), rule.type])
  }
  const blockers = []
  const unreadable = []
  for (const [id, types] of byRuleset) {
    const r = gh(root, ['api', `repos/${repo}/rulesets/${id}`])
    let ruleset = null
    if (r.code === 0) { try { ruleset = JSON.parse(r.out) } catch { ruleset = null } }
    if (!ruleset || typeof ruleset !== 'object') { unreadable.push(`ruleset ${id} requires ${types.join(', ')}, and its bypass list could not be read`); continue }
    if (['always', 'exempt'].includes(ruleset.current_user_can_bypass)) continue
    blockers.push(`ruleset "${ruleset.name ?? id}" requires ${types.join(', ')}`)
  }
  const parts = []
  if (blockers.length) parts.push(`${blockers.join('; ')}. Add yourself (or a role you hold, such as Repository admin) to its bypass list with "Always allow"`)
  if (unreadable.length) parts.push(unreadable.join('; '))
  return { ok: !parts.length, detail: parts.join('. ') }
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
  const sync = fetched.code === 0 ? syncState(root) : { needed: true, safe: false, problems: ['fetch failed'] }
  check(`in sync with origin/${RELEASE_BRANCH}`, fetched.code === 0 && head && head === remote,
    fetched.code !== 0 ? `fetch failed: ${fetched.err.trim()}` : `HEAD ${head.slice(0, 7)} differs from origin/${RELEASE_BRANCH} ${remote.slice(0, 7) || '(missing)'}; ${sync.safe ? 'run "release.mjs prepare"' : 'pull or push first'}`)

  const warnings = []
  const auth = gh(root, ['auth', 'status', '--hostname', 'github.com'])
  const ghOk = check('GitHub CLI installed and signed in', auth.code === 0,
    /ENOENT|not recognized|not found/.test(auth.err) ? 'gh not found; install it (winget install GitHub.cli) and run gh auth login' : auth.err.trim().split('\n')[0])
  if (ghOk && repo && mode === 'release') {
    const rules = pushRuleBlockers(root, repo)
    if (rules.warning) warnings.push(rules.warning)
    else check(`rulesets allow a direct push to ${RELEASE_BRANCH}`, rules.ok, rules.detail)
  }

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

  return { ok: checks.every(c => c.ok), checks, warnings, state, version: target, repo, head, sync }
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
