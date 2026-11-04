// Keep a Changelog 1.1.0 parsing, validation and editing, plus the version
// rules from standards/versioning.md. Pure functions over the file text.

export const TYPES = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']
export const BREAKING = '**Breaking:**'

export const HEADER = [
  '# Changelog',
  '',
  'All notable changes to this project will be documented in this file.',
  '',
  'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),',
  'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).',
  '',
  '## [Unreleased]',
  '',
].join('\n')

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/
const PRE = /^1\.0\.0-pre\.([1-9]\d*)$/
const SECTION = /^## \[([^\]]+)\](.*)$/
const RELEASE_SUFFIX = /^ - (\d{4}-\d{2}-\d{2})( \[YANKED\])?$/
const LINK_DEF = /^\[([^\]]+)\]:\s*(\S+)\s*$/
const GROUP = /^### (.*)$/
const BULLET = /^- \S/
const CONTINUATION = /^\s+\S/

// ---------- versions ----------

export function parseSemver(text) {
  const m = SEMVER.exec(text)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] }
}

/** SemVer 2.0.0 precedence: negative if a < b, 0 if equal, positive if a > b. */
export function compareSemver(a, b) {
  const x = parseSemver(a)
  const y = parseSemver(b)
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] - y[k]
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (x.pre[i] === undefined) return -1
    if (y.pre[i] === undefined) return 1
    const nx = /^\d+$/.test(x.pre[i])
    const ny = /^\d+$/.test(y.pre[i])
    if (nx && ny && +x.pre[i] !== +y.pre[i]) return +x.pre[i] - +y.pre[i]
    if (nx !== ny) return nx ? -1 : 1
    if (x.pre[i] !== y.pre[i]) return x.pre[i] < y.pre[i] ? -1 : 1
  }
  return 0
}

/** Bump size required by a set of change groups (SemVer, 1.0.0 and later). */
export function bumpFor(groups) {
  const entries = Object.values(groups).flat()
  if (groups.Removed?.length || entries.some(e => e.text.includes(BREAKING))) return 'major'
  if (groups.Added?.length || groups.Deprecated?.length) return 'minor'
  return 'patch'
}

/**
 * Next version per standards/versioning.md. `last` is the latest released
 * version or null. Returns { version, reason } or { version: null, reason }.
 */
export function nextVersion(last, groups) {
  if (!last) return { version: '1.0.0-pre.1', reason: 'first release' }
  const pre = PRE.exec(last)
  if (pre) return { version: `1.0.0-pre.${+pre[1] + 1}`, reason: `pre-1.0 release after ${last}` }
  const v = parseSemver(last)
  if (!v) return { version: null, reason: `${last} is not a valid SemVer version` }
  if (v.pre.length) return { version: null, reason: `${last} does not follow the 1.0.0-pre.N scheme; pass the version explicitly` }
  if (v.major === 0) return { version: '1.0.0-pre.1', reason: `${last} predates the pre.N scheme; pre-1.0 releases continue as 1.0.0-pre.N` }
  const bump = bumpFor(groups)
  const version = bump === 'major' ? `${v.major + 1}.0.0` : bump === 'minor' ? `${v.major}.${v.minor + 1}.0` : `${v.major}.${v.minor}.${v.patch + 1}`
  const why = { major: 'breaking change or removal', minor: 'Added or Deprecated entries, no breaking change', patch: 'fixes and non-breaking changes only' }[bump]
  return { version, reason: `${bump}: ${why}` }
}

/** Checks a requested version against the rules. Returns an error message or null. */
export function checkRequested(last, requested, computed) {
  if (!parseSemver(requested)) return `${requested} is not a valid SemVer version`
  if (last && compareSemver(requested, last) <= 0) return `${requested} is not greater than the last release ${last}`
  if (computed && PRE.test(computed)) {
    if (requested === computed || requested === '1.0.0') return null
    return `before 1.0 the next release is ${computed} (or 1.0.0, if you are declaring the interface stable)`
  }
  if (parseSemver(requested).pre.length) return 'pre-release suffixes are only used before 1.0 (1.0.0-pre.N)'
  if (computed && compareSemver(requested, computed) < 0) return `the Unreleased entries require at least ${computed}`
  return null
}

// ---------- parsing ----------

/** Splits the text into lines, sections and link definitions. Line numbers are 0-based. */
export function parseChangelog(text) {
  text = text.replace(/^\uFEFF/, '')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  const sections = []
  const links = []
  let current = null
  lines.forEach((line, i) => {
    const def = LINK_DEF.exec(line)
    if (def) { links.push({ label: def[1], url: def[2], line: i }); current = null; return }
    const h = SECTION.exec(line)
    if (h) {
      current = { label: h[1], rest: h[2], line: i, end: i + 1, body: [] }
      sections.push(current)
      return
    }
    if (line.startsWith('## ')) current = null
    if (current) { current.body.push({ text: line, line: i }); current.end = i + 1 }
  })
  for (const s of sections) Object.assign(s, describeSection(s))
  return { eol, lines, sections, links }
}

function describeSection(s) {
  const unreleased = s.label === 'Unreleased'
  const m = RELEASE_SUFFIX.exec(s.rest)
  const { groups, stray, problems } = parseGroups(s.body)
  return {
    unreleased,
    version: unreleased ? null : s.label,
    date: m?.[1] ?? null,
    yanked: Boolean(m?.[2]),
    groups,
    stray,
    problems,
  }
}

/** Groups a section body into change types. Each entry keeps its continuation lines. */
function parseGroups(body) {
  const groups = {}
  const order = []
  const stray = []
  const problems = []
  let group = null
  for (const { text, line } of body) {
    const g = GROUP.exec(text)
    if (g) {
      const name = g[1].trim()
      if (!TYPES.includes(name)) problems.push({ line, message: `unknown change type "${name}" (use ${TYPES.join(', ')})` })
      else if (groups[name]) problems.push({ line, message: `duplicate "${name}" group` })
      group = groups[name] = groups[name] ?? []
      order.push({ name, line })
      continue
    }
    if (!text.trim()) continue
    if (group && BULLET.test(text)) group.push({ text, lines: [text], line })
    else if (group?.length && CONTINUATION.test(text)) { group.at(-1).lines.push(text); group.at(-1).text += ` ${text.trim()}` }
    else stray.push({ line, text })
  }
  for (const { name, line } of order) if (TYPES.includes(name) && !groups[name].length) problems.push({ line, message: `"${name}" group has no entries` })
  const known = order.map(o => o.name).filter(n => TYPES.includes(n))
  const sorted = [...known].sort((a, b) => TYPES.indexOf(a) - TYPES.indexOf(b))
  if (known.join() !== sorted.join()) problems.push({ line: order[0].line, message: `change types out of order (expected ${TYPES.join(', ')})` })
  for (const name of Object.keys(groups)) if (!TYPES.includes(name)) delete groups[name]
  return { groups, stray, problems }
}

export const latestRelease = parsed => parsed.sections.find(s => !s.unreleased && s.version) ?? null
export const unreleasedSection = parsed => parsed.sections.find(s => s.unreleased) ?? null
export const hasEntries = section => Object.values(section?.groups ?? {}).some(g => g.length)

// ---------- validation ----------

function validDate(text) {
  const d = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text
}

/** Returns format findings: [{ line (1-based), message }]. */
export function lintChangelog(text) {
  const { lines, sections, links } = parseChangelog(text)
  const findings = []
  const add = (line, message) => findings.push({ line: line + 1, message })
  const first = lines.findIndex(l => l.trim())
  if (first < 0 || lines[first] !== '# Changelog') add(Math.max(first, 0), 'first line must be "# Changelog"')
  lines.forEach((l, i) => { if (l.startsWith('## ') && !SECTION.test(l)) add(i, 'version heading must be "## [<version>] - YYYY-MM-DD" or "## [Unreleased]"') })

  const unreleased = sections.filter(s => s.unreleased)
  if (!unreleased.length) add(0, 'missing "## [Unreleased]" section')
  else if (sections[0] !== unreleased[0]) add(unreleased[0].line, '"## [Unreleased]" must be the first section')
  for (const s of unreleased.slice(1)) add(s.line, 'duplicate "## [Unreleased]" section')
  for (const s of unreleased) if (s.rest) add(s.line, 'the Unreleased heading takes no date')

  let prev = null
  const seen = new Set()
  for (const s of sections.filter(s => !s.unreleased)) {
    if (!parseSemver(s.label)) { add(s.line, `"${s.label}" is not a valid SemVer version`); continue }
    if (!RELEASE_SUFFIX.test(s.rest)) add(s.line, 'release heading must end with " - YYYY-MM-DD" (optionally " [YANKED]")')
    else if (!validDate(s.date)) add(s.line, `invalid date ${s.date}`)
    if (seen.has(s.label)) add(s.line, `duplicate version ${s.label}`)
    else if (prev && compareSemver(s.label, prev.label) > 0) add(s.line, `${s.label} is listed below the older ${prev.label}; newest versions come first`)
    else if (prev?.date && s.date && s.date > prev.date) add(s.line, `${s.label} is dated after the newer ${prev.label}`)
    seen.add(s.label)
    prev = s
  }

  for (const s of sections) {
    for (const p of s.problems) add(p.line, p.message)
    for (const st of s.stray) add(st.line, 'text outside a change-type group; entries are "- " bullets under "### <type>"')
    if (!s.unreleased && !s.yanked && !hasEntries(s)) add(s.line, `${s.label} has no entries`)
  }

  const versionLinks = links.filter(l => l.label.toLowerCase() === 'unreleased' || parseSemver(l.label))
  if (versionLinks.length) {
    const defined = new Set(versionLinks.map(l => l.label.toLowerCase()))
    for (const s of sections) if (!defined.has(s.label.toLowerCase())) add(s.line, `no link definition for [${s.label}]`)
    const labels = new Set(sections.map(s => s.label.toLowerCase()))
    for (const l of versionLinks) if (!labels.has(l.label.toLowerCase())) add(l.line, `link definition [${l.label}] has no matching section`)
  }
  return findings.sort((a, b) => a.line - b.line)
}

// ---------- editing ----------

function renderGroups(groups) {
  const out = []
  for (const name of TYPES) {
    if (!groups[name]?.length) continue
    out.push(`### ${name}`, '', ...groups[name].flatMap(e => e.lines), '')
  }
  return out
}

function join(lines, eol) {
  const collapsed = lines.filter((l, i) => !(l === '' && lines[i - 1] === ''))
  while (collapsed.at(-1) === '') collapsed.pop()
  return collapsed.join(eol) + eol
}

/** Adds an entry to Unreleased under its change type. Breaking entries go first. */
export function addEntry(text, type, entry) {
  if (!TYPES.includes(type)) throw new Error(`unknown change type "${type}" (use ${TYPES.join(', ')})`)
  const parsed = parseChangelog(text)
  const section = unreleasedSection(parsed)
  if (!section) throw new Error('no "## [Unreleased]" section')
  if (section.problems.length || section.stray.length) throw new Error('the Unreleased section does not lint cleanly; run "changelog.mjs lint" first')
  const line = `- ${entry.trim().replace(/^- /, '')}`
  const groups = { ...section.groups, [type]: [...(section.groups[type] ?? [])] }
  const item = { text: line, lines: [line] }
  if (line.includes(BREAKING)) groups[type].unshift(item)
  else groups[type].push(item)
  const before = parsed.lines.slice(0, section.line + 1)
  const after = parsed.lines.slice(section.end)
  return join([...before, '', ...renderGroups(groups), ...after], parsed.eol)
}

/** Base GitHub URL (https://github.com/owner/repo) from an existing link definition. */
function baseFromLinks(links) {
  for (const l of links) {
    const m = /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/(?:compare|releases)\//.exec(l.url)
    if (m) return m[1]
  }
  return null
}

function linkBlock(versions, base) {
  return [
    `[unreleased]: ${base}/compare/v${versions[0]}...HEAD`,
    ...versions.map((v, i) => versions[i + 1]
      ? `[${v}]: ${base}/compare/v${versions[i + 1]}...v${v}`
      : `[${v}]: ${base}/releases/tag/v${v}`),
  ]
}

/**
 * Moves the Unreleased entries into a new "## [version] - date" section and
 * regenerates version link definitions when a GitHub base URL is known
 * (argument, or derived from existing definitions).
 */
export function releaseChangelog(text, version, date, repoUrl) {
  const parsed = parseChangelog(text)
  const section = unreleasedSection(parsed)
  if (!section) throw new Error('no "## [Unreleased]" section')
  if (!hasEntries(section)) throw new Error('the Unreleased section has no entries')
  if (parsed.sections.some(s => s.label === version)) throw new Error(`${version} is already in the changelog`)
  const isVersionLink = l => l.label.toLowerCase() === 'unreleased' || parseSemver(l.label)
  const base = repoUrl ?? baseFromLinks(parsed.links)
  const drop = new Set(base ? parsed.links.filter(isVersionLink).map(l => l.line) : [])
  const keep = (from, to) => parsed.lines.slice(from, to).filter((_, i) => !drop.has(from + i))
  const out = [
    ...keep(0, section.line + 1),
    '',
    `## [${version}] - ${date}`,
    '',
    ...renderGroups(section.groups),
    ...keep(section.end, parsed.lines.length),
  ]
  if (base) {
    const versions = [version, ...parsed.sections.filter(s => !s.unreleased && parseSemver(s.label)).map(s => s.label)]
    while (out.at(-1) === '') out.pop()
    out.push('', ...linkBlock(versions, base))
  }
  return join(out, parsed.eol)
}

/** The body of a version's section (for release notes), or null if absent. */
export function sectionNotes(text, version) {
  const section = parseChangelog(text).sections.find(s => s.label === version)
  if (!section) return null
  return renderGroups(section.groups).join('\n').trim()
}
