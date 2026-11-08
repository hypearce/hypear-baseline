// Commit checks for pull requests. Hygiene: commits meant to be squashed or
// reworded before merge should not reach a PR. Subjects: the mechanical rules of
// standards/commits.md, reported as auto-fix findings.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { git } from '../lib/proc.mjs'

const UNFINISHED = /^(fixup|squash|amend)! |^\W*wip\b/i
const MAX_SUBJECT = 72
const COMMITLINT_FILES = [
  '.commitlintrc', '.commitlintrc.json', '.commitlintrc.yaml', '.commitlintrc.yml', '.commitlintrc.js', '.commitlintrc.cjs', '.commitlintrc.mjs', '.commitlintrc.ts',
  'commitlint.config.js', 'commitlint.config.cjs', 'commitlint.config.mjs', 'commitlint.config.ts',
]

/** Returns { findings, notes }. */
export function commitChecks(root, scope) {
  // Merge commit subjects are written by Git or GitHub, so only non-merge commits are checked.
  const log = git(root, 'log', '--no-merges', '--format=%h%x09%s', `${scope.base}..HEAD`)
  if (log.code !== 0) {
    return { findings: [{ severity: 'risk', rule: 'commit-hygiene', file: 'git log', message: `Could not list the commits to check: ${log.err.trim()}` }], notes: [] }
  }
  const ownConvention = hasOwnCommitConvention(root)
  const findings = log.out.split('\n').filter(Boolean).flatMap(row => {
    // Split on the first tab only; a subject can contain tabs.
    const i = row.indexOf('\t')
    const [hash, subject] = [row.slice(0, i), row.slice(i + 1)]
    return [...hygiene(hash, subject), ...(ownConvention ? [] : subjectRules(hash, subject))]
  })
  const notes = ownConvention ? ['Commit subjects: skipped, the project defines its own commit convention (commitlint).'] : []
  return { findings, notes }
}

function hasOwnCommitConvention(root) {
  if (COMMITLINT_FILES.some(name => existsSync(join(root, name)))) return true
  try {
    return 'commitlint' in JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  } catch {
    return false
  }
}

function hygiene(hash, subject) {
  if (!UNFINISHED.test(subject)) return []
  return [{ severity: 'bug', rule: 'commit-hygiene', file: `commit ${hash}`, message: `"${subject}" is a work-in-progress or fixup commit. Squash or reword it before opening the PR (\`git rebase -i --autosquash\`).` }]
}

function subjectRules(hash, subject) {
  const found = []
  // Count characters, not UTF-16 code units.
  const length = [...subject].length
  if (length > MAX_SUBJECT) {
    found.push({ severity: 'autofix', rule: 'commit-subject-length', file: `commit ${hash}`, message: `Subject is ${length} characters (limit ${MAX_SUBJECT}): "${subject}". Reword it to ${MAX_SUBJECT} characters or fewer; move detail to the body.` })
  }
  if (subject.endsWith('.')) {
    found.push({ severity: 'autofix', rule: 'commit-subject-period', file: `commit ${hash}`, message: `Subject ends with a period: "${subject}". Reword it without the trailing period.` })
  }
  return found
}
