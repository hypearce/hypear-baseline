---
description: Propose adding the review tooling (ESLint, knip, dependency-cruiser, etc.) to the current project
---

Set up the hypear-baseline review tooling for this project. This changes the project, so propose before acting.

1. **Detect:** languages in the repository, package manager, and which tools are already configured. The baseline configs are in `<plugin root>/configs/` (plugin root is listed under "Review tooling" in your instructions).
2. **Propose** a plan listing, for each missing tool: the packages to install (as dev dependencies), the config file to add, and any project-specific adjustments (for example, dependency-cruiser boundary rules matching this repo's packages). Never overwrite an existing config; propose changes to it instead.
   System tools the review uses when they are on PATH (not project dependencies; mention any that apply to this repository's languages): gitleaks, shellcheck, hadolint, PSScriptAnalyzer.
3. **Flag the backlog:** if adding a linter to an existing codebase, estimate the size of the initial findings (run it once without saving changes if possible) and recommend whether to fix them now or lint only changed files at first. The review script already lints only changed files.
4. **Wait for my approval**, then install and add the configs. Do not commit.
