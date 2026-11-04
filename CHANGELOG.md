# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Always-on standards: voice, problem-solving approach, coding standards, response format and versioning rules.
- Deterministic review engine (`scripts/review.mjs`): project commands, secret scanning, debug leftovers, suppressions, weakened tests, sensitive files, JSON/YAML syntax, duplicate IDs, broken Markdown links, portability, shell syntax, Compose validation, Electron security, and optional ESLint, tsc, knip, dependency-cruiser, shellcheck, hadolint and PSScriptAnalyzer.
- `pre-push` and `code-review` skills, with `reviewer-general`, `reviewer-typescript` and `reviewer-content` agents.
- `testing` and `debugging` skills.
- `changelog` skill and `scripts/changelog.mjs`: Keep a Changelog 1.1.0 format, entry writing rules, lint, add, status and notes commands.
- `release` skill and `scripts/release.mjs`: releases from `main` only; updates the changelog and version declarations, pushes the release commit and creates the GitHub release.
- `/review`, `/pr` and `/review-setup` commands.
- Baseline ESLint, knip and dependency-cruiser configs for TypeScript projects.
