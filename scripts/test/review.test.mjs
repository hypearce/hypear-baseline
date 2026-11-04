// Tests for the deterministic review. Run: node --test scripts/test/review.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { brokenLinks, findDuplicateIds, findDuplicateKeys } from '../checks/agnostic.mjs'
import { caseCollisions } from '../checks/portability.mjs'

const REVIEW = join(dirname(fileURLToPath(import.meta.url)), '..', 'review.mjs')

function makeRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hypear-review-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const sh = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(r.stderr)
  }
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  sh('init', '-q', '-b', 'main')
  sh('config', 'user.email', 'test@example.com')
  sh('config', 'user.name', 'test')
  sh('config', 'core.autocrlf', 'false')
  return { dir, sh, write }
}

function review(dir, ...args) {
  const r = spawnSync(process.execPath, [REVIEW, '--json', '--no-project', ...args], { cwd: dir, encoding: 'utf8' })
  return { code: r.status, report: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }
}

const rules = report => new Set(report.findings.map(f => f.rule))

test('findDuplicateKeys reports repeated keys per object only', () => {
  assert.deepEqual(findDuplicateKeys('{"a":1,"a":2}').map(d => d.key), ['a'])
  assert.deepEqual(findDuplicateKeys('{"a":{"a":1},"b":[{"a":1},{"a":2}]}'), [])
  assert.deepEqual(findDuplicateKeys('{"x":"a","y":"a"}'), [])
})

test('clean change passes', t => {
  const { dir, sh, write } = makeRepo(t)
  write('src/a.ts', 'export const a = 1\n')
  sh('add', '-A'); sh('commit', '-qm', 'base')
  sh('checkout', '-qb', 'feature')
  write('src/b.ts', 'export const b = 2\n')
  sh('add', '-A'); sh('commit', '-qm', 'add b')
  const { code, report } = review(dir, '--base', 'main')
  assert.equal(code, 0)
  assert.equal(report.result, 'pass')
  assert.deepEqual(report.languages, ['typescript'])
})

test('seeded problems are detected and block', t => {
  const { dir, sh, write } = makeRepo(t)
  write('package.json', '{\n  "name": "x",\n  "dependencies": {}\n}\n')
  write('pnpm-lock.yaml', 'lockfileVersion: 9\n')
  sh('add', '-A'); sh('commit', '-qm', 'base')
  sh('checkout', '-qb', 'feature')
  write('package.json', '{\n  "name": "x",\n  "dependencies": {\n    "electron": "^30.0.0"\n  }\n}\n')
  write('src/bad.ts', 'const k = "AKIAABCDEFGHIJKLMNOP"\ndebugger\n<<<<<<< HEAD\nconsole.log(k)\n')
  write('src/bad.test.ts', 'it.only("x", () => {})\n')
  write('dup.json', '{"a": 1, "a": 2}\n')
  write('broken.json', '{"a": 1,}\n')
  write('src/main.ts', 'new BrowserWindow({ webPreferences: { nodeIntegration: true } })\nipcMain.handle("save", (event, data) => write(data))\n')
  write('dist/app.js', 'built\n')
  sh('add', '-A', '-f'); sh('commit', '-qm', 'seeded')
  const { code, report } = review(dir, '--base', 'main')
  assert.equal(code, 1)
  assert.equal(report.result, 'fail')
  for (const rule of ['secret', 'debugger', 'conflict-marker', 'console-log', 'focused-test', 'duplicate-json-key', 'invalid-json', 'generated-file', 'lockfile-not-updated', 'electron-security', 'electron-ipc-validation']) {
    assert.ok(rules(report).has(rule), `expected rule ${rule}`)
  }
})

test('version bump alone does not trigger the lockfile rule', t => {
  const { dir, sh, write } = makeRepo(t)
  write('package.json', '{\n  "name": "x",\n  "version": "0.1.0"\n}\n')
  sh('add', '-A'); sh('commit', '-qm', 'base')
  sh('checkout', '-qb', 'bump')
  write('package.json', '{\n  "name": "x",\n  "version": "0.2.0"\n}\n')
  sh('commit', '-qam', 'bump')
  assert.equal(review(dir, '--base', 'main').report.result, 'pass')
})

test('guarded Electron calls and CLI output are not flagged', t => {
  const { dir, sh, write } = makeRepo(t)
  write('package.json', '{ "devDependencies": { "electron": "^30.0.0" } }\n')
  sh('add', '-A'); sh('commit', '-qm', 'base')
  sh('checkout', '-qb', 'feature')
  write('src/main/index.ts', [
    'win.webContents.setWindowOpenHandler(({ url }) => {',
    '  if (/^https?:\\/\\//.test(url)) void shell.openExternal(url)',
    '})',
    'void win.loadURL(devUrl)',
    'ipcMain.handle(IPC.load, (_event, dir: string) => load(Schema.parse(dir)))',
  ].join('\n'))
  write('packages/cli/src/run.ts', 'console.log("done")\n')
  sh('add', '-A'); sh('commit', '-qm', 'feature')
  const { report } = review(dir, '--base', 'main')
  assert.deepEqual(report.findings, [])
})

test('full mode labels Electron findings outside the change', t => {
  const { dir, sh, write } = makeRepo(t)
  write('package.json', '{ "devDependencies": { "electron": "^30.0.0" } }\n')
  write('src/main/window.ts', 'new BrowserWindow({ webPreferences: { sandbox: false } })\n')
  sh('add', '-A'); sh('commit', '-qm', 'base')
  sh('checkout', '-qb', 'feature')
  write('src/other.ts', 'export const x = 1\n')
  sh('add', '-A'); sh('commit', '-qm', 'feature')
  assert.deepEqual(review(dir, '--base', 'main').report.findings, [])
  const full = review(dir, '--base', 'main', '--full').report
  assert.equal(full.findings.length, 1)
  assert.equal(full.findings[0].outsideChange, true)
})

test('warns when project commands run against a dirty working tree', t => {
  const { dir, sh, write } = makeRepo(t)
  write('Makefile', 'test:\n\tnode -e "0"\n')
  write('a.ts', 'export const a = 1\n')
  sh('add', '-A'); sh('commit', '-qm', 'base')
  sh('checkout', '-qb', 'feature')
  write('b.ts', 'export const b = 1\n')
  sh('add', '-A'); sh('commit', '-qm', 'feature')
  write('a.ts', 'export const a = 2\n')
  const r = spawnSync(process.execPath, [REVIEW, '--json', '--base', 'main'], { cwd: dir, encoding: 'utf8' })
  const report = JSON.parse(r.stdout)
  assert.ok(report.checks.some(c => c.name === 'make test' && c.status === 'passed'))
  assert.match(report.warnings?.[0] ?? '', /uncommitted changes/)
})

test('repository with no commits reviews all files', t => {
  const { dir, write } = makeRepo(t)
  write('data/a.json', '{"id": "a"}\n')
  const { code, report } = review(dir)
  assert.equal(code, 0)
  assert.equal(report.scope.mode, 'initial')
  assert.equal(report.files, 1)
})

test('working mode includes uncommitted and untracked files', t => {
  const { dir, sh, write } = makeRepo(t)
  write('a.ts', 'export const a = 1\n')
  sh('add', '-A'); sh('commit', '-qm', 'base')
  sh('checkout', '-qb', 'wip')
  write('b.ts', 'debugger\n')
  const committedOnly = review(dir, '--base', 'main').report
  assert.equal(committedOnly.files, 0)
  const working = review(dir, '--base', 'main', '--working').report
  assert.ok(rules(working).has('debugger'))
})

// Commits a base on main, then applies `change` on a feature branch and commits it.
function branchRepo(t, base, change) {
  const repo = makeRepo(t)
  base(repo)
  repo.sh('add', '-A'); repo.sh('commit', '-qm', 'base')
  repo.sh('checkout', '-qb', 'feature')
  change(repo)
  repo.sh('add', '-A'); repo.sh('commit', '-qm', 'feature')
  return repo
}

// A fake package whose bin records the arguments it receives.
function fakeTool(write, pkg, bin) {
  write(`node_modules/${pkg}/package.json`, JSON.stringify({ name: pkg, bin: { [bin]: 'bin.js' } }))
  write(`node_modules/${pkg}/bin.js`, `require('fs').writeFileSync(__dirname + '/args.json', JSON.stringify(process.argv.slice(2)))\n`)
}

const findingsFor = (report, rule) => report.findings.filter(f => f.rule === rule)

test('unit: findDuplicateIds, caseCollisions and brokenLinks', () => {
  assert.deepEqual(findDuplicateIds({ a: [{ id: 'x' }, { id: 'y' }, { id: 'x' }], b: [{ id: 'y' }] }), ['x'])
  assert.deepEqual(caseCollisions(['src/a.ts', 'Src/b.ts', 'Src/c/d.ts']), [['Src', 'src']])
  assert.deepEqual(caseCollisions(['README.md', 'docs/readme.md']), [])
  const entries = new Set(['docs', 'docs/a.md', 'img.png'])
  const text = '[ok](docs/a.md#part) [web](https://x.y) [anchor](#top) [bad](docs/b.md)\n```\n[skip](nope.md)\n```\n[ref]: ./img.png\n[up](../outside.md)'
  assert.deepEqual(brokenLinks('README.md', text, entries), [{ line: 1, target: 'docs/b.md' }])
})

test('sensitive files are flagged; templates are not', t => {
  const { dir } = branchRepo(t, ({ write }) => write('a.txt', 'a\n'), ({ write }) => {
    write('app/.env', 'TOKEN=1\n')
    write('app/.env.example', 'TOKEN=\n')
    write('certs/server.pem', 'x\n')
  })
  const { code, report } = review(dir, '--base', 'main')
  assert.equal(code, 1)
  assert.deepEqual(findingsFor(report, 'sensitive-file').map(f => [f.file, f.severity]), [['app/.env', 'bug'], ['certs/server.pem', 'risk']])
})

test('suppressions, skipped and removed tests are reported', t => {
  const { dir } = branchRepo(t, ({ write }) => {
    write('src/a.test.ts', 'test("one", () => {})\ntest("two", () => {})\n')
    write('src/old.test.ts', 'test("old", () => {})\n')
  }, ({ write, sh }) => {
    write('src/a.ts', '// @ts-ignore\nexport const a = 1 as any\n')
    write('src/a.test.ts', 'test.skip("one", () => {})\n// @ts-expect-error\nconst x: number = "s"\n')
    sh('rm', '-q', 'src/old.test.ts')
  })
  const { report } = review(dir, '--base', 'main')
  assert.equal(findingsFor(report, 'suppression').length, 2, 'ts-expect-error in a test file is allowed')
  assert.ok(findingsFor(report, 'suppression').every(f => f.file === 'src/a.ts'))
  assert.equal(findingsFor(report, 'skipped-test').length, 1)
  assert.deepEqual(findingsFor(report, 'test-removed').map(f => f.file).sort(), ['src/a.test.ts', 'src/old.test.ts'])
})

test('source change without a test change is a cleanup hint only when the repo has tests', t => {
  const withTests = branchRepo(t, ({ write }) => write('test/a.test.mjs', 'test("a", () => {})\n'), ({ write }) => write('src/a.mjs', 'export const a = 1\n'))
  const r = review(withTests.dir, '--base', 'main').report
  assert.deepEqual(findingsFor(r, 'no-test-change').map(f => f.severity), ['cleanup'])
  assert.equal(r.result, 'warn')
  const noTests = branchRepo(t, ({ write }) => write('README.md', 'x\n'), ({ write }) => write('src/a.mjs', 'export const a = 1\n'))
  assert.deepEqual(findingsFor(review(noTests.dir, '--base', 'main').report, 'no-test-change'), [])
})

test('python print, duplicate ids and broken links are reported', t => {
  const { dir } = branchRepo(t, ({ write }) => write('docs/guide.md', '# Guide\n'), ({ write }) => {
    write('app/main.py', 'def f():\n    print("here")\n')
    write('data/pack.json', '{\n  "items": [\n    { "id": "a" },\n    { "id": "a" }\n  ]\n}\n')
    write('README.md', 'See [guide](docs/guide.md) and [missing](docs/missing.md).\n')
  })
  const { report } = review(dir, '--base', 'main')
  assert.equal(findingsFor(report, 'print-debug').length, 1)
  assert.deepEqual(findingsFor(report, 'duplicate-id').map(f => f.line), [4])
  assert.deepEqual(findingsFor(report, 'broken-link').map(f => f.message), ['Relative link target `docs/missing.md` does not exist.'])
})

test('portability: CRLF scripts, missing executable bit, case collisions', t => {
  const { dir } = branchRepo(t, ({ write }) => write('src/a.txt', 'a\n'), ({ write }) => {
    write('deploy.sh', '#!/usr/bin/env bash\r\necho hi\r\n')
  })
  // Committed through the index: a case-insensitive file system cannot hold both src/ and Src/.
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim()
  git('update-index', '--add', '--cacheinfo', `100644,${git('hash-object', '-w', 'src/a.txt')},Src/b.txt`)
  git('commit', '-qm', 'collide')
  const { code, report } = review(dir, '--base', 'main')
  assert.equal(code, 1)
  assert.ok(findingsFor(report, 'crlf-line-endings').some(f => f.file === 'deploy.sh'))
  assert.ok(findingsFor(report, 'not-executable').some(f => f.file === 'deploy.sh'))
  assert.equal(findingsFor(report, 'case-collision').length, 1)
})

test('portability: executable LF scripts pass, and working-tree CRLF is ignored when git normalizes it', t => {
  const { dir, sh, write } = branchRepo(t, ({ write }) => write('.gitattributes', '* text=auto eol=lf\n'), ({ write, sh }) => {
    write('run.sh', '#!/bin/sh\necho ok\n')
    sh('add', 'run.sh'); sh('update-index', '--chmod=+x', 'run.sh')
  })
  assert.deepEqual(review(dir, '--base', 'main').report.findings.filter(f => ['crlf-line-endings', 'not-executable'].includes(f.rule)), [])
  write('run.sh', '#!/bin/sh\r\necho ok\r\n')
  assert.deepEqual(findingsFor(review(dir, '--base', 'main', '--working').report, 'crlf-line-endings'), [])
})

test('shell syntax errors are reported with a line number', t => {
  const { dir } = branchRepo(t, ({ write }) => write('a.txt', 'a\n'), ({ write }) => write('bad.sh', 'if true; then\n  echo x\n'))
  const { report } = review(dir, '--base', 'main')
  if (report.skipped.some(s => s.startsWith('Shell syntax: bash not found'))) return t.skip('bash not available')
  const [finding] = findingsFor(report, 'shell-syntax')
  assert.equal(finding?.file, 'bad.sh')
  assert.ok(finding.line >= 2)
})

test('commit hygiene runs in full mode only', t => {
  const { dir, sh, write } = branchRepo(t, ({ write }) => write('a.txt', 'a\n'), ({ write }) => write('b.txt', 'b\n'))
  write('b.txt', 'b2\n'); sh('commit', '-qam', 'fixup! feature')
  assert.deepEqual(findingsFor(review(dir, '--base', 'main').report, 'commit-hygiene'), [])
  const full = review(dir, '--base', 'main', '--full').report
  assert.equal(findingsFor(full, 'commit-hygiene').length, 1)
  assert.equal(full.result, 'fail')
})

test('file names reach installed tools verbatim, without a shell', t => {
  const name = "src/it's $HOME.ts"
  const { dir } = branchRepo(t, ({ write }) => {
    write('.gitignore', 'node_modules/\n')
    write('package.json', '{ "name": "x" }\n')
    write('eslint.config.mjs', 'export default []\n')
    fakeTool(write, 'eslint', 'eslint')
  }, ({ write }) => write(name, 'export const a = 1\n'))
  const { report } = review(dir, '--base', 'main')
  assert.ok(report.checks.some(c => c.name === 'eslint (changed files)' && c.status === 'passed'))
  const args = JSON.parse(readFileSync(join(dir, 'node_modules/eslint/args.json'), 'utf8'))
  assert.deepEqual(args, ['--no-warn-ignored', name])
})

test('tsc runs as a fallback only when no project command type-checks', t => {
  const setup = extra => ({ write }) => {
    write('.gitignore', 'node_modules/\n')
    write('package.json', '{ "name": "x" }\n')
    write('tsconfig.json', '{ "compilerOptions": { "strict": true } }\n')
    fakeTool(write, 'typescript', 'tsc')
    extra(write)
  }
  const change = ({ write }) => write('src/a.ts', 'export const a = 1\n')
  const fallback = branchRepo(t, setup(() => {}), change)
  assert.ok(review(fallback.dir, '--base', 'main').report.checks.some(c => c.name.startsWith('tsc --noEmit')))
  const covered = branchRepo(t, setup(write => write('Makefile', 'test:\n\tpnpm typecheck\n')), change)
  assert.ok(!review(covered.dir, '--base', 'main').report.checks.some(c => c.name.startsWith('tsc --noEmit')))
})
