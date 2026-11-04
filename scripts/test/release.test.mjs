// Tests for the changelog and release helpers. Run: node --test scripts/test/release.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  HEADER, addEntry, checkRequested, compareSemver, lintChangelog, nextVersion, parseChangelog,
  releaseChangelog, sectionNotes, unreleasedSection,
} from '../lib/changelog.mjs'
import { findDeclarations, writeDeclarations } from '../lib/versions.mjs'

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..')

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hypear-release-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return { dir, write, read: path => readFileSync(join(dir, path), 'utf8') }
}

const groups = text => unreleasedSection(parseChangelog(HEADER + text)).groups

const VALID = `${HEADER}
### Added

- New thing.

## [1.0.0-pre.2] - 2026-10-02

### Fixed

- A fix.
  Continued on a second line.

## [1.0.0-pre.1] - 2026-09-01 [YANKED]

[unreleased]: https://github.com/o/r/compare/v1.0.0-pre.2...HEAD
[1.0.0-pre.2]: https://github.com/o/r/compare/v1.0.0-pre.1...v1.0.0-pre.2
[1.0.0-pre.1]: https://github.com/o/r/releases/tag/v1.0.0-pre.1
`

test('compareSemver follows SemVer precedence', () => {
  const ordered = ['1.0.0-pre.1', '1.0.0-pre.2', '1.0.0-pre.10', '1.0.0', '1.0.1', '1.1.0', '2.0.0']
  for (let i = 1; i < ordered.length; i++) assert.ok(compareSemver(ordered[i - 1], ordered[i]) < 0, `${ordered[i - 1]} < ${ordered[i]}`)
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0)
})

test('nextVersion: pre.N before 1.0, SemVer bumps after', () => {
  assert.equal(nextVersion(null, {}).version, '1.0.0-pre.1')
  assert.equal(nextVersion('1.0.0-pre.3', groups('### Removed\n\n- X.\n')).version, '1.0.0-pre.4')
  assert.equal(nextVersion('0.3.0', {}).version, '1.0.0-pre.1')
  assert.equal(nextVersion('1.2.3', groups('### Fixed\n\n- X.\n')).version, '1.2.4')
  assert.equal(nextVersion('1.2.3', groups('### Changed\n\n- Y.\n')).version, '1.2.4')
  assert.equal(nextVersion('1.2.3', groups('### Added\n\n- X.\n')).version, '1.3.0')
  assert.equal(nextVersion('1.2.3', groups('### Changed\n\n- **Breaking:** X.\n')).version, '2.0.0')
  assert.equal(nextVersion('1.2.3', groups('### Removed\n\n- X.\n')).version, '2.0.0')
  assert.equal(nextVersion('2.0.0-rc.1', {}).version, null)
})

test('nextVersion reports a latest heading that is not SemVer instead of throwing', () => {
  assert.deepEqual(nextVersion('1.0', {}), { version: null, reason: '1.0 is not a valid SemVer version' })
})

test('checkRequested enforces the versioning rules', () => {
  assert.equal(checkRequested('1.0.0-pre.3', '1.0.0-pre.4', '1.0.0-pre.4'), null)
  assert.equal(checkRequested('1.0.0-pre.3', '1.0.0', '1.0.0-pre.4'), null)
  assert.match(checkRequested('1.0.0-pre.3', '1.0.0-pre.6', '1.0.0-pre.4'), /next release is 1\.0\.0-pre\.4/)
  assert.match(checkRequested('1.0.0-pre.3', '0.5.0', '1.0.0-pre.4'), /not greater/)
  assert.match(checkRequested('1.2.3', '1.2.4', '1.3.0'), /at least 1\.3\.0/)
  assert.equal(checkRequested('1.2.3', '2.0.0', '1.3.0'), null)
  assert.match(checkRequested('1.2.3', '1.3.0-rc.1', '1.3.0'), /only used before 1\.0/)
  assert.match(checkRequested(null, 'v1', '1.0.0-pre.1'), /not a valid SemVer/)
})

test('lint accepts a valid changelog and reports format problems', () => {
  assert.deepEqual(lintChangelog(VALID), [])
  assert.deepEqual(lintChangelog(HEADER), [])
  const bad = [
    '# Changelog', '', '## [1.0.0] - 2026-01-01', '', '### Fixed', '', '- A.', '',
    '## [Unreleased]', '', 'Loose text.', '', '### Fixed', '', '- B.', '', '### Added', '', '- C.', '', '### Notes', '', '- D.', '',
    '## [1.1.0] - 2026-02-30', '', '### Added', '', '## Version 0.9', '',
    '[1.0.0]: https://github.com/o/r/releases/tag/v1.0.0', '',
  ].join('\n')
  assert.deepEqual(lintChangelog(bad).map(f => [f.line, f.message.split(' (')[0]]), [
    [9, '"## [Unreleased]" must be the first section'],
    [9, 'no link definition for [Unreleased]'],
    [11, 'text outside a change-type group; entries are "- " bullets under "### <type>"'],
    [13, 'change types out of order'],
    [21, 'unknown change type "Notes"'],
    [25, 'invalid date 2026-02-30'],
    [25, '1.1.0 is listed below the older 1.0.0; newest versions come first'],
    [25, '1.1.0 has no entries'],
    [25, 'no link definition for [1.1.0]'],
    [27, '"Added" group has no entries'],
    [29, 'version heading must be "## [<version>] - YYYY-MM-DD" or "## [Unreleased]"'],
  ])
})

test('addEntry places entries by type order; breaking entries first', () => {
  let text = addEntry(HEADER, 'Fixed', 'A fix.')
  text = addEntry(text, 'Added', 'A feature.')
  text = addEntry(text, 'Added', '**Breaking:** Renamed the config key; rename `a` to `b`.')
  assert.equal(text, `${HEADER}
### Added

- **Breaking:** Renamed the config key; rename \`a\` to \`b\`.
- A feature.

### Fixed

- A fix.
`)
  assert.deepEqual(lintChangelog(text), [])
  assert.throws(() => addEntry(HEADER, 'Misc', 'x'), /unknown change type/)
})

test('addEntry keeps link definitions that end the file after a blank line', () => {
  const link = '[unreleased]: https://github.com/o/r/compare/v1.0.0-pre.1...HEAD'
  const result = addEntry(`${HEADER}\n${link}\n\n`, 'Added', 'x')
  assert.ok(result.endsWith(`\n${link}\n`), result)
  assert.deepEqual(lintChangelog(result), [])
})

test('a UTF-8 byte order mark does not fail the lint', () => {
  assert.deepEqual(lintChangelog(`\uFEFF${VALID}`), [])
})

test('releaseChangelog moves Unreleased into a dated section and regenerates links', () => {
  const released = releaseChangelog(VALID, '1.0.0-pre.3', '2026-11-03')
  assert.deepEqual(lintChangelog(released), [])
  const parsed = parseChangelog(released)
  assert.deepEqual(parsed.sections.map(s => s.label), ['Unreleased', '1.0.0-pre.3', '1.0.0-pre.2', '1.0.0-pre.1'])
  assert.equal(parsed.sections[0].body.filter(l => l.text.trim()).length, 0)
  assert.equal(parsed.sections[1].date, '2026-11-03')
  assert.deepEqual(parsed.links.map(l => `${l.label} ${l.url}`), [
    'unreleased https://github.com/o/r/compare/v1.0.0-pre.3...HEAD',
    '1.0.0-pre.3 https://github.com/o/r/compare/v1.0.0-pre.2...v1.0.0-pre.3',
    '1.0.0-pre.2 https://github.com/o/r/compare/v1.0.0-pre.1...v1.0.0-pre.2',
    '1.0.0-pre.1 https://github.com/o/r/releases/tag/v1.0.0-pre.1',
  ])
  assert.equal(sectionNotes(released, '1.0.0-pre.3'), '### Added\n\n- New thing.')
  assert.equal(sectionNotes(released, '1.0.0-pre.2'), '### Fixed\n\n- A fix.\n  Continued on a second line.')
  assert.throws(() => releaseChangelog(HEADER, '1.0.0-pre.1', '2026-11-03'), /no entries/)
  assert.throws(() => releaseChangelog(VALID, '1.0.0-pre.2', '2026-11-03'), /already in the changelog/)
})

test('first release adds link definitions when the GitHub URL is given', () => {
  const released = releaseChangelog(addEntry(HEADER, 'Added', 'First.'), '1.0.0-pre.1', '2026-11-03', 'https://github.com/o/r')
  assert.deepEqual(lintChangelog(released), [])
  assert.ok(released.endsWith('[unreleased]: https://github.com/o/r/compare/v1.0.0-pre.1...HEAD\n[1.0.0-pre.1]: https://github.com/o/r/releases/tag/v1.0.0-pre.1\n'))
})

test('version declarations are found and updated without reformatting', t => {
  const { dir, write, read } = tempDir(t)
  write('package.json', '{\n    "name": "x",\n    "version": "1.0.0-pre.1",\n    "dependencies": { "y": "1.0.0-pre.1" }\n}\n')
  write('package-lock.json', JSON.stringify({ name: 'x', version: '1.0.0-pre.1', packages: { '': { version: '1.0.0-pre.1' } } }, null, 2) + '\n')
  write('.claude-plugin/plugin.json', '{\n  "name": "p",\n  "version": "1.0.0-pre.1"\n}\n')
  write('.claude-plugin/marketplace.json', '{\n  "plugins": [{ "name": "other", "version": "9.9.9" }, { "name": "p", "version": "1.0.0-pre.1" }]\n}\n')
  write('pyproject.toml', '[tool.ruff]\nversion = "0"\n\n[project]\nname = "x"\nversion = "1.0.0-pre.1"\n')
  const decls = findDeclarations(dir)
  assert.deepEqual(decls.map(d => `${d.file} ${d.where}`), [
    'package.json version', 'package-lock.json version', 'package-lock.json packages[""].version',
    '.claude-plugin/plugin.json version', '.claude-plugin/marketplace.json plugins[1].version', 'pyproject.toml [project] version',
  ])
  writeDeclarations(dir, decls, '1.0.0-pre.2')
  assert.ok(findDeclarations(dir).every(d => d.version === '1.0.0-pre.2'))
  assert.equal(JSON.parse(read('package.json')).version, '1.0.0-pre.2')
  assert.equal(JSON.parse(read('package.json')).dependencies.y, '1.0.0-pre.1')
  assert.match(read('package.json'), /^\{\n {4}"name"/)
  assert.match(read('.claude-plugin/marketplace.json'), /\{ "name": "other", "version": "9\.9\.9" \}, \{ "name": "p", "version": "1\.0\.0-pre\.2" \}/)
  assert.match(read('pyproject.toml'), /\[tool\.ruff\]\nversion = "0"\n/)
})

// ---------- release.mjs against a local "GitHub" origin ----------

function releaseRepo(t) {
  const { dir: base } = tempDir(t)
  const dir = join(base, 'work')
  const bare = join(base, 'origin.git').replace(/\\/g, '/')
  const sh = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(r.stderr)
    return r.stdout
  }
  mkdirSync(dir)
  sh(base, 'init', '-q', '--bare', '-b', 'main', bare)
  sh(dir, 'init', '-q', '-b', 'main')
  for (const [k, v] of [['user.email', 'test@example.com'], ['user.name', 'test'], ['core.autocrlf', 'false']]) sh(dir, 'config', k, v)
  sh(dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git')
  sh(dir, 'config', `url.${bare}.insteadOf`, 'https://github.com/o/r.git')
  const write = (path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text) }
  write('CHANGELOG.md', `${HEADER}\n### Added\n\n- First feature.\n`)
  write('.claude-plugin/plugin.json', '{\n  "name": "p",\n  "version": "0.1.0"\n}\n')
  write('src.txt', 'x\n')
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-qm', 'init'); sh(dir, 'push', '-q', '-u', 'origin', 'main')

  const ghLog = join(base, 'gh.json')
  const fakeGh = join(base, 'gh.mjs')
  writeFileSync(fakeGh, `import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(args) + '\\n')
if (args[0] === 'release' && args[1] === 'view') process.exit(1)
if (args[0] === 'release' && args[1] === 'create' && process.env.FAKE_GH_FAIL_CREATE) { console.error('HTTP 502'); process.exit(1) }
if (args[0] === 'release' && args[1] === 'create') console.log('https://github.com/o/r/releases/tag/' + args[2])
`)
  const env = { ...process.env, HYPEAR_RELEASE_GH: fakeGh }
  const release = (...args) => {
    const r = spawnSync(process.execPath, [join(SCRIPTS, 'release.mjs'), ...args, '--json'], { cwd: dir, encoding: 'utf8', env })
    return { code: r.status, out: JSON.parse(r.stdout) }
  }
  const ghCalls = () => readFileSync(ghLog, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  return { dir, base, bare, sh, write, release, ghCalls, env }
}

test('release run: commits changelog and declarations, pushes main, creates the GitHub release', t => {
  const { dir, bare, sh, write, release, ghCalls } = releaseRepo(t)
  // An uncommitted changelog edit is allowed and lands in the release commit.
  write('CHANGELOG.md', `${HEADER}\n### Added\n\n- First feature.\n\n### Fixed\n\n- Late fix.\n`)
  const plan = release('plan')
  assert.equal(plan.code, 0, JSON.stringify(plan.out.checks))
  assert.equal(plan.out.version, '1.0.0-pre.1')
  assert.deepEqual(plan.out.files, ['CHANGELOG.md', '.claude-plugin/plugin.json'])

  const run = release('run', '--version', '1.0.0-pre.1', '--co-author', 'Bot <bot@example.com>')
  assert.equal(run.code, 0, JSON.stringify(run.out))
  assert.equal(sh(bare, 'rev-parse', 'main').trim(), run.out.sha)
  assert.equal(sh(dir, 'log', '-1', '--format=%B').trim(), 'Release v1.0.0-pre.1\n\nCo-Authored-By: Bot <bot@example.com>')
  assert.deepEqual(sh(dir, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort(), ['.claude-plugin/plugin.json', 'CHANGELOG.md'])
  const changelog = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8')
  assert.match(changelog, /## \[Unreleased\]\n\n## \[1\.0\.0-pre\.1\] - \d{4}-\d{2}-\d{2}\n\n### Added\n\n- First feature\.\n\n### Fixed\n\n- Late fix\.\n/)
  assert.match(changelog, /\[1\.0\.0-pre\.1\]: https:\/\/github\.com\/o\/r\/releases\/tag\/v1\.0\.0-pre\.1\n$/)
  assert.equal(JSON.parse(readFileSync(join(dir, '.claude-plugin/plugin.json'), 'utf8')).version, '1.0.0-pre.1')
  const create = ghCalls().find(a => a[1] === 'create')
  assert.deepEqual(create.slice(0, 7), ['release', 'create', 'v1.0.0-pre.1', '--repo', 'o/r', '--target', run.out.sha])
  assert.ok(create.includes('--prerelease'))

  const again = release('plan')
  assert.equal(again.code, 1)
  assert.ok(again.out.checks.some(c => c.name === 'Unreleased has entries' && !c.ok))
})

test('release refuses to run off main, with local changes, or with an unexpected version', t => {
  const { dir, sh, write, release } = releaseRepo(t)
  assert.match(release('run', '--version', '1.0.0-pre.5').out.checks.find(c => !c.ok).detail, /next release is 1\.0\.0-pre\.1/)
  write('src.txt', 'changed\n')
  assert.ok(release('plan').out.checks.some(c => c.name === 'no uncommitted changes other than CHANGELOG.md' && !c.ok))
  sh(dir, 'checkout', '-q', '--', 'src.txt')
  sh(dir, 'checkout', '-qb', 'feature')
  const off = release('run', '--version', '1.0.0-pre.1')
  assert.equal(off.code, 1)
  assert.ok(off.out.checks.some(c => c.name === 'on main' && !c.ok))
  assert.equal(sh(dir, 'status', '--porcelain'), '')
})

test('release run: a failed GitHub release leaves the pushed commit, and publish completes it', t => {
  const { dir, bare, sh, release, ghCalls, env } = releaseRepo(t)
  env.FAKE_GH_FAIL_CREATE = '1'
  const run = release('run', '--version', '1.0.0-pre.1')
  assert.equal(run.code, 1)
  assert.equal(run.out.error.includes('HTTP 502'), true, JSON.stringify(run.out))
  assert.equal(sh(bare, 'rev-parse', 'main').trim(), run.out.sha)

  delete env.FAKE_GH_FAIL_CREATE
  const publish = release('publish', '--version', '1.0.0-pre.1')
  assert.equal(publish.code, 0, JSON.stringify(publish.out))
  assert.deepEqual(ghCalls().filter(a => a[1] === 'create').at(-1).slice(5, 7), ['--target', run.out.sha])

  sh(dir, 'commit', '-q', '--allow-empty', '-m', 'later work')
  sh(dir, 'push', '-q', 'origin', 'main')
  const late = release('publish', '--version', '1.0.0-pre.1')
  assert.equal(late.code, 1)
  assert.ok(late.out.checks.some(c => c.name === 'HEAD is the release commit for 1.0.0-pre.1' && !c.ok))
})

test('release run: a failed push keeps the local release commit and reports how to continue', t => {
  const { dir, bare, sh, release } = releaseRepo(t)
  const before = sh(bare, 'rev-parse', 'main').trim()
  writeFileSync(join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\necho rejected >&2\nexit 1\n')
  chmodSync(join(bare, 'hooks', 'pre-receive'), 0o755)
  const run = release('run', '--version', '1.0.0-pre.1')
  assert.equal(run.code, 1)
  assert.equal(run.out.error, 'push failed')
  assert.equal(sh(bare, 'rev-parse', 'main').trim(), before)
  assert.equal(sh(dir, 'log', '-1', '--format=%s').trim(), 'Release v1.0.0-pre.1')
})

test('release run: a failed write restores the changelog and declarations', t => {
  const { dir, sh, write, release } = releaseRepo(t)
  const edited = `${HEADER}\n### Added\n\n- First feature.\n- Uncommitted entry.\n`
  write('CHANGELOG.md', edited)
  const plugin = join(dir, '.claude-plugin/plugin.json')
  const original = readFileSync(plugin, 'utf8')
  chmodSync(plugin, 0o444)
  const run = release('run', '--version', '1.0.0-pre.1')
  assert.equal(run.code, 1)
  assert.match(run.out.error, /EPERM|EACCES/)
  assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), edited)
  assert.equal(readFileSync(plugin, 'utf8'), original)
  assert.equal(sh(dir, 'log', '-1', '--format=%s').trim(), 'init')
})
