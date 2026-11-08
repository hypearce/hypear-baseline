# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Commit message standard (`standards/commits.md`) and pull request standard (`standards/pull-requests.md`), loaded every session: subject and body rules, trailers, PR titles, and short PR descriptions with Summary, Changes and Closes sections and no attribution. `/pr` and the code-review and release skills follow them. (#4)
- Auto-fix review level for low-stakes fixes that cannot change behavior, such as commit message format or a typo in a comment. Claude applies them without asking, and every one is listed in the review report's Auto-fixed section and the PR description. Criteria are in `docs/review-design.md`. Auto-fix findings never block a review or count as warnings. (#4)
- Full review (`--full`) reports commit subjects over 72 characters or ending in a period as auto-fix findings, except in projects with a commitlint configuration. `scripts/reword.mjs` applies the fixes: it checks each new message with the project's commit-msg hook, rewords commits in place, keeps merge commits and uncommitted changes, and leaves the branch unchanged if anything fails. Needs git 2.38 or later. (#4)

## [1.0.0-pre.2] - 2026-11-04

### Changed

- Pre-1.0 releases now use `0.MINOR.PATCH-pre`, starting at `0.1.0-pre`, where breaking, `Removed`, `Added` and `Deprecated` entries bump MINOR and everything else bumps PATCH. Repositories that already released `1.0.0-pre.N` (including this one) continue counting N until 1.0.0.

## [1.0.0-pre.1] - 2026-11-04

### Added

- Always-on standards: voice, problem-solving approach, coding standards, response format and versioning rules.
- Deterministic review engine (`scripts/review.mjs`): project commands, secret scanning, debug leftovers, suppressions, weakened tests, sensitive files, JSON/YAML syntax, duplicate IDs, broken Markdown links, portability, shell syntax, Compose validation, Electron security, and optional ESLint, tsc, knip, dependency-cruiser, shellcheck, hadolint and PSScriptAnalyzer.
- `pre-push` and `code-review` skills, with `reviewer-general`, `reviewer-typescript` and `reviewer-content` agents.
- `testing` and `debugging` skills.
- `changelog` skill and `scripts/changelog.mjs`: Keep a Changelog 1.1.0 format, entry writing rules, lint, add, status and notes commands.
- `release` skill and `scripts/release.mjs`: releases from `main` only; updates the changelog and version declarations, pushes the release commit and creates the GitHub release.
- `/review`, `/pr` and `/review-setup` commands.
- Baseline ESLint, knip and dependency-cruiser configs for TypeScript projects.

[unreleased]: https://github.com/hypearce/hypear-baseline/compare/v1.0.0-pre.2...HEAD
[1.0.0-pre.2]: https://github.com/hypearce/hypear-baseline/compare/v1.0.0-pre.1...v1.0.0-pre.2
[1.0.0-pre.1]: https://github.com/hypearce/hypear-baseline/releases/tag/v1.0.0-pre.1
