#!/usr/bin/env node
// Changelog helper (Keep a Changelog 1.1.0, standards/versioning.md).
//
//   node changelog.mjs lint                 validate CHANGELOG.md
//   node changelog.mjs init                 create CHANGELOG.md
//   node changelog.mjs add <Type> <text>    add an Unreleased entry (Type: Added, Changed, ...)
//   node changelog.mjs status               last release, next version, version declarations
//   node changelog.mjs notes <version>      print a version's section
//
// Options: --json. Exit codes: 0 ok, 1 findings or refused, 2 usage error or could not run.
import { existsSync, writeFileSync } from 'node:fs'
import { HEADER, TYPES, addEntry, sectionNotes } from './lib/changelog.mjs'
import { CHANGELOG, changelogState, repoRoot } from './lib/release.mjs'

const argv = process.argv.slice(2)
const json = argv.includes('--json')
const [command, ...rest] = argv.filter(a => a !== '--json')

function out(data, text) {
  process.stdout.write(json ? `${JSON.stringify(data, null, 2)}\n` : `${text}\n`)
}

function fail(code, message) {
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`)
  else process.stderr.write(`${message}\n`)
  process.exit(code)
}

const root = repoRoot(process.cwd()) ?? process.cwd()
const state = changelogState(root)
const needFile = () => { if (!state.exists) fail(1, `${CHANGELOG} not found in ${root}; create it with "changelog.mjs init"`) }

switch (command) {
  case 'lint': {
    needFile()
    out({ ok: !state.lint.length, findings: state.lint },
      state.lint.length ? state.lint.map(f => `${CHANGELOG}:${f.line}: ${f.message}`).join('\n') : `${CHANGELOG}: ok`)
    process.exit(state.lint.length ? 1 : 0)
  }
  case 'init': {
    if (existsSync(state.path)) fail(1, `${CHANGELOG} already exists`)
    writeFileSync(state.path, HEADER)
    out({ ok: true, file: CHANGELOG }, `Created ${CHANGELOG}`)
    break
  }
  case 'add': {
    needFile()
    const [type, ...words] = rest
    const match = TYPES.find(t => t.toLowerCase() === type?.toLowerCase())
    if (!match || !words.length) fail(2, `usage: changelog.mjs add <${TYPES.join('|')}> <text>`)
    try {
      writeFileSync(state.path, addEntry(state.text, match, words.join(' ')))
    } catch (e) {
      fail(1, e.message)
    }
    out({ ok: true, type: match }, `Added to Unreleased / ${match}`)
    break
  }
  case 'status': {
    needFile()
    const data = {
      lastRelease: state.latest,
      unreleasedEntries: state.entries,
      next: state.next,
      declarations: state.declarations,
      mismatched: state.mismatched,
      lintFindings: state.lint.length,
    }
    const decl = state.declarations.length
      ? state.declarations.map(d => `  - ${d.file} ${d.where}: ${d.version}${state.mismatched.includes(d) ? ' (does not match the last release)' : ''}`).join('\n')
      : '  - none found'
    out(data, [
      `Last release: ${state.latest ?? 'none'}`,
      `Unreleased entries: ${state.entries}`,
      `Next version: ${state.next.version ?? 'cannot compute'} (${state.next.reason})`,
      `Format findings: ${state.lint.length}${state.lint.length ? ' (run lint)' : ''}`,
      'Version declarations:',
      decl,
    ].join('\n'))
    process.exit(state.mismatched.length || state.lint.length ? 1 : 0)
  }
  case 'notes': {
    needFile()
    const notes = rest[0] && sectionNotes(state.text, rest[0])
    if (notes === null || notes === undefined) fail(1, `no section for version ${rest[0] ?? '(missing)'}`)
    out({ ok: true, version: rest[0], notes }, notes)
    break
  }
  default:
    fail(2, 'usage: changelog.mjs <lint|init|add|status|notes> [args] [--json]')
}
