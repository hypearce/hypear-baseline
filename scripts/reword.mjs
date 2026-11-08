#!/usr/bin/env node
// Rewords commit messages on the current branch without an interactive editor,
// for auto-fix findings from the review (skills/code-review step 4b).
//
//   node reword.mjs --base <ref> <hash>=<message-file> [<hash>=<message-file> ...] [--json]
//
// Each message file holds the complete new message: subject, a blank line, then
// the body and trailers to keep. The project's commit-msg hook checks each new
// message before anything changes; other commit hooks are skipped, because only
// messages change. The branch is rebased in place onto its existing merge-base
// with <ref>, merges are preserved, uncommitted changes are stashed and restored,
// and the user's rebase.updateRefs and rebase.autoSquash settings are overridden.
// Afterwards the tree must be unchanged and the subjects must match; otherwise
// the branch is put back where it was. Needs git 2.38 or later.
//
// Exit codes: 0 reworded, 1 failed (branch unchanged), 2 usage error or could not run.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { git, run } from './lib/proc.mjs'

const PLAN_ENV = 'HYPEAR_REWORD_PLAN'
const TODO_PICK = /^(?:pick|p)\s+([0-9a-f]+)\b/
// Characters that would break a double-quoted path in the sh command lines git runs.
const UNSAFE_IN_QUOTES = /["$`\\\n]/

// Invoked by git as the sequence editor: adds an amend after each target commit.
if (process.argv[2] === '--todo-editor') {
  process.exit(editTodo(process.argv[3], JSON.parse(process.env[PLAN_ENV] ?? '[]')))
}

function editTodo(todoPath, plan) {
  const lines = readFileSync(todoPath, 'utf8').split('\n')
  const matched = new Set()
  const out = lines.flatMap(line => {
    const short = TODO_PICK.exec(line)?.[1]
    const target = short && plan.find(p => p.sha.startsWith(short))
    if (!target) return [line]
    matched.add(target.sha)
    // --no-verify: the commit-msg hook already ran on this message, and the files do not change.
    return [line, `exec git commit --amend --allow-empty --no-verify -q -F "${target.file}"`]
  })
  // A non-zero exit makes git abort the rebase before it changes anything.
  if (matched.size !== plan.length) return 1
  writeFileSync(todoPath, out.join('\n'))
  return 0
}

const argv = process.argv.slice(2)
const json = argv.includes('--json')
const lines = []
const say = text => lines.push(text)
function finish(code, data) {
  process.stdout.write(json ? `${JSON.stringify({ ...data, code }, null, 2)}\n` : `${lines.join('\n')}\n`)
  process.exit(code)
}
const fail = (code, error) => { say(error); finish(code, { ok: false, error }) }
const USAGE = 'usage: reword.mjs --base <ref> <hash>=<message-file> [...] [--json]'

let baseRef
const pairs = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--json') continue
  if (a === '--base') { baseRef = argv[++i]; continue }
  if (!a.startsWith('--') && a.indexOf('=') > 0) { pairs.push(a); continue }
  fail(2, `Unexpected argument "${a}".\n${USAGE}`)
}
if (!baseRef || baseRef.startsWith('--') || pairs.length === 0) fail(2, USAGE)

const top = git(process.cwd(), 'rev-parse', '--show-toplevel')
if (top.code !== 0) fail(2, 'Not inside a git repository.')
const root = top.out.trim()
const rev = spec => {
  const r = git(root, 'rev-parse', '--verify', '-q', spec)
  return r.code === 0 ? r.out.trim() : null
}
const isAncestor = (a, b) => git(root, 'merge-base', '--is-ancestor', a, b).code === 0
const rebaseInProgress = () => ['rebase-merge', 'rebase-apply'].some(dir => existsSync(resolve(root, git(root, 'rev-parse', '--git-path', dir).out.trim())))
const forward = p => p.replaceAll('\\', '/')

if (rebaseInProgress()) fail(2, 'A rebase is already in progress. Finish or abort it first.')
if (!rev(`${baseRef}^{commit}`)) fail(2, `Base "${baseRef}" is not a commit.`)
const head = rev('HEAD')
const mergeBase = git(root, 'merge-base', baseRef, 'HEAD').out.trim()
if (!head || !mergeBase) fail(2, `No common history between ${baseRef} and HEAD.`)

const plan = pairs.map(pair => {
  const i = pair.indexOf('=')
  const [hash, file] = [pair.slice(0, i), resolve(pair.slice(i + 1))]
  const sha = rev(`${hash}^{commit}`)
  if (!sha) fail(2, `${hash} is not a commit.`)
  if (sha === mergeBase || !isAncestor(mergeBase, sha) || !isAncestor(sha, head)) fail(2, `${hash} is not on this branch after ${baseRef}.`)
  if (git(root, 'rev-list', '--no-walk', '--min-parents=2', sha).out.trim()) fail(2, `${hash} is a merge commit; merge subjects are not reworded.`)
  if (!existsSync(file) || !statSync(file).isFile()) fail(2, `Message file not found: ${file}`)
  if (UNSAFE_IN_QUOTES.test(forward(file))) fail(2, `Message file path contains characters that cannot be quoted safely: ${file}`)
  return { hash, sha, file: forward(file) }
})
const seen = new Set()
for (const p of plan) {
  if (seen.has(p.sha)) fail(2, `${p.hash} refers to a commit that is already listed.`)
  seen.add(p.sha)
}

// The project's commit-msg hook checks (and may amend) each message before any history changes.
for (const p of plan) {
  const hook = run('git', ['hook', 'run', '--ignore-missing', 'commit-msg', '--', p.file], { cwd: root })
  if (hook.code !== 0) fail(1, `The commit-msg hook rejected the new message for ${p.hash}; the branch is unchanged.\n${(hook.err || hook.out).trim()}`)
  const text = readFileSync(p.file, 'utf8').replace(/^\s*\n/, '')
  const [subject = '', second = ''] = text.split('\n')
  if (!subject.trim()) fail(2, `Message file has no subject: ${p.file}`)
  // git reads the whole first paragraph as the subject, so the body must be separated by a blank line.
  if (second.trim()) fail(2, `Message file needs a blank line after the subject: ${p.file}`)
  p.subject = subject.trim()
}

const subjects = () => git(root, 'log', '--no-merges', '--format=%s', `${mergeBase}..HEAD`).out.split('\n').filter(Boolean).sort()
const expected = git(root, 'log', '--no-merges', '--format=%H%x09%s', `${mergeBase}..HEAD`).out.split('\n').filter(Boolean)
  .map(row => {
    const i = row.indexOf('\t')
    return plan.find(p => p.sha === row.slice(0, i))?.subject ?? row.slice(i + 1)
  })
  .sort()
const tree = rev('HEAD^{tree}')

const [nodePath, scriptPath] = [forward(process.execPath), forward(fileURLToPath(import.meta.url))]
if (UNSAFE_IN_QUOTES.test(nodePath + scriptPath)) fail(2, `The Node.js or script path contains characters that cannot be quoted safely: ${nodePath}, ${scriptPath}`)
const rebase = run('git', ['rebase', '-q', '-i', '--keep-base', '--autostash', '--rebase-merges', '--no-update-refs', '--no-autosquash', baseRef], {
  cwd: root,
  env: { ...process.env, GIT_SEQUENCE_EDITOR: `"${nodePath}" "${scriptPath}" --todo-editor`, [PLAN_ENV]: JSON.stringify(plan) },
})

if (rebase.code !== 0) {
  const inProgress = rebaseInProgress()
  if (inProgress) git(root, 'rebase', '--abort')
  fail(1, `Rebase failed${inProgress ? ' and was aborted' : ''}; the branch is unchanged.\n${(rebase.err || rebase.out).trim()}`)
}

// Subjects are compared as a multiset; the todo list addresses commits by unique hashes, so a swap cannot occur.
const problems = []
if (rev('HEAD^{tree}') !== tree) problems.push('the tree changed')
if (JSON.stringify(subjects()) !== JSON.stringify(expected)) problems.push('the subjects do not match the message files')
if (problems.length) {
  const restored = git(root, 'reset', '-q', '--keep', head).code === 0
  fail(1, `Reword verification failed: ${problems.join(' and ')}. ${restored ? `The branch was reset to ${head.slice(0, 7)}.` : `Could not reset automatically; the previous HEAD was ${head}.`}`)
}

// Pushed: on the upstream branch, or on any remote-tracking branch.
const upstream = rev('@{u}')
const pushed = sha => Boolean(upstream && isAncestor(sha, upstream)) || git(root, 'branch', '-r', '--contains', sha).out.trim() !== ''
const results = plan.map(p => ({ hash: p.hash, subject: p.subject, pushed: pushed(p.sha) }))
for (const r of results) say(`Reworded ${r.hash}: "${r.subject}"${r.pushed ? ' (was pushed; the next push needs --force-with-lease)' : ''}`)
finish(0, { ok: true, head: rev('HEAD'), reworded: results })
