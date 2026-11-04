// Commit hygiene for pull requests: commits meant to be squashed or reworded
// before merge should not reach a PR.
import { git } from '../lib/proc.mjs'

const UNFINISHED = /^(fixup|squash|amend)! |^\W*wip\b/i

export function commitChecks(root, scope) {
  const log = git(root, 'log', '--format=%h%x09%s', `${scope.base}..HEAD`)
  return log.out.split('\n').filter(Boolean).flatMap(row => {
    const [hash, subject = ''] = row.split('\t')
    if (!UNFINISHED.test(subject)) return []
    return [{ severity: 'bug', rule: 'commit-hygiene', file: `commit ${hash}`, message: `"${subject}" is a work-in-progress or fixup commit. Squash or reword it before opening the PR (\`git rebase -i --autosquash\`).` }]
  })
}
