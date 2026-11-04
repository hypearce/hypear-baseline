#!/usr/bin/env node
// Release helper: cuts a release from main (standards/versioning.md).
//
//   node release.mjs plan [--version X]            checks and plan; changes nothing
//   node release.mjs run --version X [--co-author "Name <email>"]
//        release commit (CHANGELOG.md + version declarations), push to main, GitHub release
//   node release.mjs publish --version X           GitHub release only, for a release commit already pushed
//
// Options: --json. Exit codes: 0 ok, 1 checks failed or a step failed, 2 usage error or could not run.
import { sectionNotes, releaseChangelog } from './lib/changelog.mjs'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git } from './lib/proc.mjs'
import {
  RELEASE_BRANCH, applyRelease, localDate, preflight, publishRelease, releaseFiles, repoRoot, tagFor,
} from './lib/release.mjs'

const argv = process.argv.slice(2)
const json = argv.includes('--json')
// A flag followed by another flag has no value; '' makes the usage checks reject it.
const option = name => {
  const i = argv.indexOf(name)
  if (i < 0) return undefined
  const value = argv[i + 1]
  return value === undefined || value.startsWith('--') ? '' : value
}
const command = argv[0]
const requested = option('--version')
const coAuthor = option('--co-author')

const lines = []
const say = text => lines.push(text)
function finish(code, data) {
  process.stdout.write(json ? `${JSON.stringify({ ...data, code }, null, 2)}\n` : `${lines.join('\n')}\n`)
  process.exit(code)
}

const root = repoRoot(process.cwd())
if (!root) { say('Not inside a git repository.'); finish(2, { ok: false, error: 'not a git repository' }) }
if (!['plan', 'run', 'publish'].includes(command)) { say('usage: release.mjs <plan|run|publish> [--version X] [--co-author "Name <email>"] [--json]'); finish(2, { ok: false, error: 'usage' }) }
if (command !== 'plan' && !requested) { say(`${command} requires --version (use the version from "plan").`); finish(2, { ok: false, error: 'missing --version' }) }

const pf = preflight(root, { mode: command === 'publish' ? 'publish' : 'release', version: requested })
const checkLines = pf.checks.map(c => `- [${c.ok ? 'x' : ' '}] ${c.name}${!c.ok && c.detail ? `: ${c.detail}` : ''}`)
const summary = { ok: pf.ok, version: pf.version, repo: pf.repo, checks: pf.checks }

if (command === 'plan') {
  const date = localDate()
  let notes = null
  if (pf.state.exists && pf.version && pf.state.entries) {
    try { notes = sectionNotes(releaseChangelog(pf.state.text, pf.version, date), pf.version) } catch { notes = null }
  }
  const files = pf.state.exists ? releaseFiles(pf.state) : []
  say(`# Release plan: ${pf.ok ? 'READY' : 'BLOCKED'}`)
  say('')
  say(`- Repository: ${pf.repo ?? 'unknown'} (${RELEASE_BRANCH} @ ${pf.head.slice(0, 7)})`)
  say(`- Last release: ${pf.state.latest ?? 'none'}`)
  say(`- Version: ${pf.version ?? 'unknown'}${!requested && pf.state.next ? ` (${pf.state.next.reason})` : ''}`)
  say(`- Date: ${date}`)
  say(`- Commit: "Release ${pf.version ? tagFor(pf.version) : '?'}", changing ${files.join(', ') || 'nothing'}`)
  say(`- Push: ${RELEASE_BRANCH} to origin`)
  say(`- GitHub release: ${pf.version ? tagFor(pf.version) : '?'}${pf.version?.includes('-') ? ', marked as pre-release' : ''}`)
  say('')
  say('## Checks')
  say('')
  lines.push(...checkLines)
  if (notes) { say(''); say('## Release notes'); say(''); say(notes) }
  finish(pf.ok ? 0 : 1, { ...summary, date, files, notes })
}

if (!pf.ok) {
  say(`Release ${tagFor(requested)} blocked. Nothing was changed.`)
  say('')
  lines.push(...checkLines)
  finish(1, summary)
}

if (command === 'publish') {
  const r = publishRelease(root, { version: requested, repo: pf.repo, sha: pf.head })
  say(r.ok ? `Created GitHub release ${tagFor(requested)}: ${r.url}` : `GitHub release failed: ${r.error}`)
  finish(r.ok ? 0 : 1, { ...summary, ...r })
}

// run. Keep the current contents so a failed release can put them back,
// including uncommitted CHANGELOG.md edits.
const originals = new Map(releaseFiles(pf.state).filter(f => existsSync(join(root, f))).map(f => [f, readFileSync(join(root, f))]))
// Rewrites only files that changed, so a file that could not be written (the
// usual cause of a failure here) does not stop the others being restored.
// Returns the sentence to report.
function restore() {
  const failed = []
  for (const [f, data] of originals) {
    const path = join(root, f)
    try {
      if (!readFileSync(path).equals(data)) writeFileSync(path, data)
    } catch {
      failed.push(f)
    }
  }
  return failed.length
    ? `Could not restore ${failed.join(', ')}; check with "git diff" before retrying.`
    : 'The release edits were reverted.'
}
let files
try {
  files = applyRelease(root, pf.state, requested, pf.repo)
} catch (e) {
  say(`Release blocked: ${e.message}. ${restore()}`)
  finish(1, { ...summary, ok: false, error: e.message })
}

const changed = git(root, 'status', '--porcelain', '--untracked-files=no').out.split('\n').filter(Boolean).map(l => l.slice(3))
const unexpected = changed.filter(f => !files.includes(f))
if (unexpected.length) {
  say(`Release aborted: unexpected changes to ${unexpected.join(', ')}. ${restore()}`)
  finish(1, { ...summary, ok: false, error: 'unexpected changes' })
}

const message = [`Release ${tagFor(requested)}`, ...(coAuthor ? ['', `Co-Authored-By: ${coAuthor}`] : [])].join('\n')
const add = git(root, 'add', '--', ...files)
const commit = add.code === 0 ? git(root, 'commit', '--quiet', '-m', message) : add
if (commit.code !== 0) {
  git(root, 'reset', '--quiet', '--', ...files)
  say(`Release commit failed: ${commit.err.trim()}. ${restore()}`)
  finish(1, { ...summary, ok: false, error: 'commit failed' })
}
const sha = git(root, 'rev-parse', 'HEAD').out.trim()

const push = git(root, 'push', '--quiet', 'origin', `HEAD:refs/heads/${RELEASE_BRANCH}`)
if (push.code !== 0) {
  say(`Release commit ${sha.slice(0, 7)} was created but the push failed: ${push.err.trim()}`)
  say(`Fix the cause, then run "git push origin ${RELEASE_BRANCH}" and "release.mjs publish --version ${requested}". To undo instead: git reset --hard origin/${RELEASE_BRANCH} (this also discards the CHANGELOG.md edits included in the release commit; they stay reachable as commit ${sha.slice(0, 7)}).`)
  finish(1, { ...summary, ok: false, sha, error: 'push failed' })
}

const r = publishRelease(root, { version: requested, repo: pf.repo, sha })
if (!r.ok) {
  say(`Pushed release commit ${sha.slice(0, 7)} to ${RELEASE_BRANCH}, but creating the GitHub release failed: ${r.error}`)
  say(`Retry with: release.mjs publish --version ${requested}`)
  finish(1, { ...summary, ok: false, sha, error: r.error })
}
say(`Released ${tagFor(requested)}: commit ${sha.slice(0, 7)} pushed to ${RELEASE_BRANCH}; GitHub release ${r.url}`)
finish(0, { ...summary, sha, url: r.url, files })
