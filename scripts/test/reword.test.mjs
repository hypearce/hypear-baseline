// Tests for the commit reword helper. Run: node --test scripts/test/reword.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const REWORD = join(dirname(fileURLToPath(import.meta.url)), '..', 'reword.mjs')

// A repo with main (base) and a feature branch with commits "Add b." and "Add c".
function makeRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hypear-reword-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const sh = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(r.stderr)
    return r.stdout.trim()
  }
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const commit = (file, message) => { write(file, `${file}\n`); sh('add', '-A'); sh('commit', '-qm', message) }
  sh('init', '-q', '-b', 'main')
  sh('config', 'user.email', 'test@example.com')
  sh('config', 'user.name', 'test')
  sh('config', 'core.autocrlf', 'false')
  commit('a.txt', 'Base')
  sh('checkout', '-qb', 'feature')
  commit('b.txt', 'Add b.')
  sh('commit', '-q', '--amend', '-m', 'Add b.', '-m', 'Body of b.', '-m', 'Co-Authored-By: Bot <bot@example.com>')
  commit('c.txt', 'Add c')
  // Message files live outside the repo, as they would in a scratchpad.
  const msgDir = mkdtempSync(join(tmpdir(), 'hypear-reword-msg-'))
  t.after(() => rmSync(msgDir, { recursive: true, force: true }))
  const message = (name, text) => { const p = join(msgDir, name); writeFileSync(p, text); return p }
  return { dir, sh, write, commit, message }
}

function reword(dir, ...args) {
  const r = spawnSync(process.execPath, [REWORD, '--json', ...args], { cwd: dir, encoding: 'utf8' })
  return { code: r.status, result: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }
}

const log = (sh, range = 'main..HEAD') => sh('log', '--format=%s', range).split('\n')

test('rewords a commit, keeps its body and trailers, and leaves the tree unchanged', t => {
  const { dir, sh, message } = makeRepo(t)
  const tree = sh('rev-parse', 'HEAD^{tree}')
  const hash = sh('rev-parse', '--short', 'HEAD~1')
  const file = message('b.txt', 'Add b\n\nBody of b.\n\nCo-Authored-By: Bot <bot@example.com>\n')
  const { code, result } = reword(dir, '--base', 'main', `${hash}=${file}`)
  assert.equal(code, 0, result?.error)
  assert.deepEqual(log(sh), ['Add c', 'Add b'])
  assert.equal(sh('log', '-1', '--format=%B', 'HEAD~1'), 'Add b\n\nBody of b.\n\nCo-Authored-By: Bot <bot@example.com>')
  assert.equal(sh('rev-parse', 'HEAD^{tree}'), tree)
  assert.equal(result.reworded[0].pushed, false)
})

test('keeps the base when main has moved, and restores uncommitted changes', t => {
  const { dir, sh, write, commit, message } = makeRepo(t)
  const mergeBase = sh('merge-base', 'main', 'HEAD')
  sh('checkout', '-q', 'main'); commit('m.txt', 'Main moves'); sh('checkout', '-q', 'feature')
  write('c.txt', 'uncommitted\n')
  const hash = sh('rev-parse', '--short', 'HEAD~1')
  const { code, result } = reword(dir, '--base', 'main', `${hash}=${message('b.txt', 'Add b\n')}`)
  assert.equal(code, 0, result?.error)
  assert.equal(sh('merge-base', 'main', 'HEAD'), mergeBase)
  assert.equal(readFileSync(join(dir, 'c.txt'), 'utf8'), 'uncommitted\n')
})

test('rewords several commits and preserves merge commits', t => {
  const { dir, sh, commit, message } = makeRepo(t)
  sh('checkout', '-qb', 'side', 'main'); commit('s.txt', 'Side work'); sh('checkout', '-q', 'feature')
  sh('merge', '-q', '--no-ff', '-m', 'Merge side', 'side')
  const b = sh('rev-parse', '--short', 'HEAD^1~1')
  const c = sh('rev-parse', '--short', 'HEAD^1')
  const { code, result } = reword(dir, '--base', 'main', `${b}=${message('b.txt', 'Add b\n')}`, `${c}=${message('c.txt', 'Add c, reworded\n')}`)
  assert.equal(code, 0, result?.error)
  assert.equal(sh('rev-list', '--merges', '--count', 'main..HEAD'), '1')
  assert.deepEqual(sh('log', '--no-merges', '--format=%s', 'main..HEAD').split('\n').sort(), ['Add b', 'Add c, reworded', 'Side work'])
})

test('works when git abbreviates rebase commands', t => {
  const { dir, sh, message } = makeRepo(t)
  sh('config', 'rebase.abbreviateCommands', 'true')
  const { code, result } = reword(dir, '--base', 'main', `${sh('rev-parse', '--short', 'HEAD')}=${message('c.txt', 'Add c, reworded\n')}`)
  assert.equal(code, 0, result?.error)
  assert.deepEqual(log(sh), ['Add c, reworded', 'Add b.'])
})

test('reports commits that were already pushed', t => {
  const { dir, sh, message } = makeRepo(t)
  sh('branch', 'published')
  sh('branch', '-q', '--set-upstream-to', 'published')
  const hash = sh('rev-parse', '--short', 'HEAD')
  const { code, result } = reword(dir, '--base', 'main', `${hash}=${message('c.txt', 'Add c, reworded\n')}`)
  assert.equal(code, 0, result?.error)
  assert.equal(result.reworded[0].pushed, true)
})

test('refuses merge commits and commits outside the branch, changing nothing', t => {
  const { dir, sh, commit, message } = makeRepo(t)
  const file = message('m.txt', 'Subject\n')
  assert.equal(reword(dir, '--base', 'main', `${sh('rev-parse', '--short', 'main')}=${file}`).code, 2)
  sh('checkout', '-qb', 'side', 'main'); commit('s.txt', 'Side'); sh('checkout', '-q', 'feature')
  sh('merge', '-q', '--no-ff', '-m', 'Merge side', 'side')
  const head = sh('rev-parse', 'HEAD')
  const { code, result } = reword(dir, '--base', 'main', `${sh('rev-parse', '--short', 'HEAD')}=${file}`)
  assert.equal(code, 2)
  assert.match(result.error, /merge commit/)
  assert.equal(sh('rev-parse', 'HEAD'), head)
})

test('a failing commit hook aborts the rebase and leaves the branch unchanged', t => {
  const { dir, sh, write, message } = makeRepo(t)
  write('.git/hooks/commit-msg', '#!/bin/sh\nexit 1\n')
  chmodSync(join(dir, '.git/hooks/commit-msg'), 0o755)
  write('c.txt', 'uncommitted\n')
  const head = sh('rev-parse', 'HEAD')
  const { code, result } = reword(dir, '--base', 'main', `${sh('rev-parse', '--short', 'HEAD~1')}=${message('b.txt', 'Add b\n')}`)
  assert.equal(code, 1)
  assert.match(result.error, /aborted/)
  assert.equal(sh('rev-parse', 'HEAD'), head)
  assert.equal(readFileSync(join(dir, 'c.txt'), 'utf8'), 'uncommitted\n')
})
