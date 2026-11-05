# hypear-baseline

Personal Claude Code defaults: voice, coding standards, problem-solving approach, and a two-layer code review system. Loaded into every project. Project-specific rules belong in each project's own `CLAUDE.md`, and those take precedence where they conflict.

## Contents

| Path | Purpose |
|---|---|
| `standards/` | Always-on guidance added to every session: voice, problem-solving, coding standards, versioning, response format |
| `hooks/register.ts` | Adds `standards/*.md` and the review tooling location to the system prompt |
| `skills/pre-push/` | Decides whether to run deterministic checks before `git push`, runs them, reports |
| `skills/code-review/` | Full review: deterministic layer, then parallel agent reviewers by language |
| `skills/testing/`, `skills/debugging/` | Testing and debugging approach |
| `skills/changelog/` | Changelog format (Keep a Changelog 1.1.0) and entry writing |
| `skills/release/` | Release from `main`: release commit, push, GitHub release |
| `agents/` | Reviewers: `reviewer-general`, `reviewer-typescript`, `reviewer-content` |
| `commands/` | `/review`, `/pr`, `/review-setup` |
| `scripts/review.mjs` | Deterministic review engine (Node, no dependencies) |
| `scripts/changelog.mjs` | Changelog `init`, `add`, `lint`, `status`, `notes` |
| `scripts/release.mjs` | Release `plan`, `run`, `publish` (needs the GitHub CLI, `gh`) |
| `configs/typescript/` | Baseline ESLint, knip and dependency-cruiser configs |
| `docs/review-design.md` | Review system design and tenets |
| `CHANGELOG.md` | Release history of this plugin |

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

## Versioning and releases

Rules: `standards/versioning.md`. Before 1.0 every release is `0.MINOR.PATCH-pre`, starting at `0.1.0-pre`; breaking, `Removed`, `Added` and `Deprecated` entries bump MINOR and everything else bumps PATCH, and after 1.0 SemVer bumps follow the changelog entry types. Releases are cut from `main` with `node scripts/release.mjs plan`, then `run --version <version>` (see `skills/release/SKILL.md`).

## Install

```
/plugin install hypear-baseline --marketplace hypearce/hypear-baseline
```

## Develop locally

```
make setup     # check for Git, Node.js, make, gh and gitleaks; offers to install missing ones (Windows, winget)
make test      # run the test suites
make check     # validate CHANGELOG.md
claude --plugin-dir ~/dev/hypear-baseline
```

Without make, run `powershell -NoProfile -ExecutionPolicy RemoteSigned -File scripts/setup.ps1` first; it can install make too.
