// Finds and updates the version declarations a repository keeps alongside its
// changelog (standards/versioning.md, "Version declarations").
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    throw new Error(`${path}: ${e.message}`, { cause: e })
  }
}

/** Returns [{ file, where, version }] for every declaration in the repository root. */
export function findDeclarations(root) {
  const found = []
  const at = file => join(root, file)

  if (existsSync(at('package.json'))) {
    const pkg = readJson(at('package.json'))
    if (typeof pkg.version === 'string') {
      found.push({ file: 'package.json', where: 'version', version: pkg.version })
      if (existsSync(at('package-lock.json'))) {
        const lock = readJson(at('package-lock.json'))
        if (typeof lock.version === 'string') found.push({ file: 'package-lock.json', where: 'version', version: lock.version })
        const rootPkg = lock.packages?.['']
        if (typeof rootPkg?.version === 'string') found.push({ file: 'package-lock.json', where: 'packages[""].version', version: rootPkg.version })
      }
    }
  }

  let pluginName = null
  if (existsSync(at('.claude-plugin/plugin.json'))) {
    const plugin = readJson(at('.claude-plugin/plugin.json'))
    pluginName = plugin.name
    if (typeof plugin.version === 'string') found.push({ file: '.claude-plugin/plugin.json', where: 'version', version: plugin.version })
  }
  if (pluginName && existsSync(at('.claude-plugin/marketplace.json'))) {
    const market = readJson(at('.claude-plugin/marketplace.json'))
    ;(market.plugins ?? []).forEach((p, i) => {
      if (p.name === pluginName && typeof p.version === 'string') found.push({ file: '.claude-plugin/marketplace.json', where: `plugins[${i}].version`, version: p.version })
    })
  }

  if (existsSync(at('pyproject.toml'))) {
    const decl = tomlVersion(readFileSync(at('pyproject.toml'), 'utf8'))
    if (decl) found.push({ file: 'pyproject.toml', where: `[${decl.table}] version`, version: decl.version })
  }

  if (existsSync(at('VERSION'))) found.push({ file: 'VERSION', where: 'file', version: readFileSync(at('VERSION'), 'utf8').trim() })
  return found
}

/** The `version = "..."` line of [project] or [tool.poetry], if present. */
function tomlVersion(text) {
  let table = null
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const t = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/.exec(lines[i])
    if (t) { table = t[1].trim(); continue }
    if (table !== 'project' && table !== 'tool.poetry') continue
    const v = /^\s*version\s*=\s*"([^"]*)"/.exec(lines[i])
    if (v) return { table, version: v[1], index: i }
  }
  return null
}

function setPath(obj, where, version) {
  if (where === 'version') obj.version = version
  else if (where === 'packages[""].version') obj.packages[''].version = version
  else {
    const m = /^plugins\[(\d+)\]\.version$/.exec(where)
    obj.plugins[+m[1]].version = version
  }
}

/**
 * Rewrites one JSON file's declarations. For a single declaration whose old
 * value occurs exactly once, replaces the literal text so formatting is
 * untouched; otherwise re-serializes with the file's indentation and line endings.
 */
function updateJson(path, decls, version) {
  const text = readFileSync(path, 'utf8')
  const pattern = old => new RegExp(`("version"\\s*:\\s*)"${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g')
  if (decls.length === 1 && (text.match(pattern(decls[0].version)) ?? []).length === 1) {
    writeFileSync(path, text.replace(pattern(decls[0].version), `$1"${version}"`))
    return
  }
  const obj = JSON.parse(text)
  for (const d of decls) setPath(obj, d.where, version)
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? 2
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  writeFileSync(path, JSON.stringify(obj, null, indent).replace(/\n/g, eol) + (/\r?\n$/.test(text) ? eol : ''))
}

/** Sets every declaration to `version`. Returns the list of files written. */
export function writeDeclarations(root, decls, version) {
  const byFile = new Map()
  for (const d of decls) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d])
  for (const [file, list] of byFile) {
    const path = join(root, file)
    if (file.endsWith('.json')) updateJson(path, list, version)
    else if (file === 'pyproject.toml') {
      const text = readFileSync(path, 'utf8')
      const eol = text.includes('\r\n') ? '\r\n' : '\n'
      const lines = text.split(/\r?\n/)
      const { index } = tomlVersion(text)
      lines[index] = lines[index].replace(/"[^"]*"/, `"${version}"`)
      writeFileSync(path, lines.join(eol))
    } else if (file === 'VERSION') {
      writeFileSync(path, `${version}${readFileSync(path, 'utf8').includes('\r\n') ? '\r\n' : '\n'}`)
    }
  }
  return [...byFile.keys()]
}
