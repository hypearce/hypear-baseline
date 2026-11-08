import type { EngineInterface, Register } from 'claude-code'

// Always-on guidance, added to the system prompt in this order.
const STANDARDS = ['voice.md', 'problem-solving.md', 'coding-standards.md', 'versioning.md', 'commits.md', 'pull-requests.md', 'issues.md', 'style.md']

let cached: string | undefined

async function loadStandards($: EngineInterface): Promise<string> {
  if (cached !== undefined) return cached
  const parts = await Promise.all(
    STANDARDS.map(name =>
      $.fs.read(`${$.plugin.root}/standards/${name}`).catch(() => ''),
    ),
  )
  const root = $.plugin.root
  cached = [
    '# hypear-baseline (personal defaults)',
    "These are the user's defaults for every project. If a project's CLAUDE.md or .claude/ rules conflict, the project wins.",
    ...parts.filter(Boolean),
    [
      '## Review tooling',
      `- Plugin root: \`${root}\``,
      `- Deterministic review: \`node "${root}/scripts/review.mjs"\` (options: --base <ref>, --working, --full, --no-project, --json). Exit 0 = pass, 1 = blocking failures, 2 = could not run.`,
      '- Before any `git push`, follow the hypear-baseline pre-push skill. Before creating a pull request, follow the code-review skill (full review).',
      `- Changelog and releases: \`node "${root}/scripts/changelog.mjs"\` and \`node "${root}/scripts/release.mjs"\`; follow the hypear-baseline changelog and release skills.`,
    ].join('\n'),
  ].join('\n\n')
  return cached
}

export const register: Register = on => {
  // Re-read the files on each load, so edits show up after a reload.
  cached = undefined

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const standards = await loadStandards($)
    return {
      ...result,
      sections: [
        ...result.sections,
        { id: `${$.plugin.name}:standards`, text: standards, scope: 'session' as const },
      ],
    }
  }).catch(($, e, next) => next(e))
}
