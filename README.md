# hypear-baseline

Personal Claude Code defaults: voice, coding standards, problem-solving approach, and a two-layer code review system. Loaded into every project. Project-specific rules belong in each project's own `CLAUDE.md`, and those take precedence where they conflict.

## Contents

| Path | Purpose |
|---|---|
| `standards/` | Always-on guidance added to every session: voice, problem-solving, coding standards, response format |
| `hooks/register.ts` | Adds `standards/*.md` and the review tooling location to the system prompt |
| `skills/pre-push/` | Decides whether to run deterministic checks before `git push`, runs them, reports |
| `skills/code-review/` | Full review: deterministic layer, then parallel agent reviewers by language |
| `skills/testing/`, `skills/debugging/` | Testing and debugging approach |
| `agents/` | Reviewers: `reviewer-general`, `reviewer-typescript`, `reviewer-content` |
| `commands/` | `/review`, `/pr`, `/review-setup` |
| `scripts/review.mjs` | Deterministic review engine (Node, no dependencies) |
| `configs/typescript/` | Baseline ESLint, knip and dependency-cruiser configs |
| `docs/review-design.md` | Review system design and tenets |

## Review system

**On push**, Claude decides whether to run the deterministic checks (criteria in `skills/pre-push/SKILL.md`) and asks when unsure. **On pull request** (`/pr`), the full review runs: deterministic checks, then agent reviewers, then a consolidated report before the PR is drafted.

The deterministic engine can also be run directly:

```
node scripts/review.mjs [--base <ref>] [--working] [--full] [--no-project] [--json]
```

| Option | Effect |
|---|---|
| `--base <ref>` | Compare against this ref (default: upstream, then origin/HEAD, then main/master) |
| `--working` | Include uncommitted and untracked changes |
| `--full` | PR mode: whole-source Electron scan, knip, dependency audit, commit hygiene |
| `--no-project` | Skip the project's own commands |
| `--json` | JSON output |

Exit codes: `0` pass, `1` blocking failures, `2` could not run.

## Install

```
/plugin install hypear-baseline --marketplace hypearce/hypear-baseline
```

## Develop locally

```
claude --plugin-dir ~/dev/hypear-baseline
node --test scripts/test/review.test.mjs
```
