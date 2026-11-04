# Review system design

Status: implemented (v0.1). This document defines how hypear-baseline reviews code before it reaches a remote repository. It is the reference for building the review skills, agents and scripts.

## Scope and enforcement

This plugin is for personal repositories. Pushes and pull requests are performed by Claude on the user's instruction, so the review process is driven by plugin instructions rather than git hooks or CI. Enforcement is deliberately soft: the process is expected to run, but the user can always override it.

## Tenets

1. **Review what is leaving.** Reviews cover the commits being pushed or proposed (`origin/<branch>..HEAD`, or the PR's base branch), not the whole repository.
2. **Deterministic first, agentic second.** Tools run first and their output is passed to the agents. Agents do not spend effort on what a tool can prove.
3. **The project's own checks are authoritative.** Discover and run the project's existing commands (`make test`, `make check`, package scripts) before any plugin defaults.
4. **Route by language.** File types in the diff determine which language checkers and reviewers run. The language-agnostic layer always runs.
5. **Report, don't silently fix.** Findings are presented to the user, ranked by severity. Code changes happen only when the user approves them.
6. **Findings are specific.** Each finding includes `file:line`, the problem, and a concrete fix. "No issues found" is a valid result.
7. **Be transparent about coverage.** Always state which checks ran, which were skipped, and why.

## Triggers

### Push: deterministic layer, at Claude's discretion

Before running `git push`, Claude decides whether to run the deterministic layer.

**Run the checks** when the commits being pushed include any of:
- Source code changes
- Dependency or lockfile changes
- Build, CI, lint or tooling configuration changes
- Content or data files that a project check validates (for example, a RouteMancer pack)

**Skip the checks** when the commits contain only:
- Documentation or comment changes
- Changes the checks already covered in this session, with no edits since

**Ask the user** when the case is unclear: for example, a large mixed change, a change to generated files, or when the checks are known to be slow.

The user can override in either direction ("push, skip checks" or "run checks first"). After every push, Claude states whether the checks ran and the result, or that they were skipped and why.

If a check fails, Claude does not push. It reports the failures and asks whether to fix them or push anyway.

### Pull request: full review

Creating a pull request runs the full review, both deterministic and agentic, through the `/pr` command or any request to open a PR:

1. Run the deterministic layer.
2. Run the agnostic reviewer and each applicable language reviewer, passing them the diff and the deterministic results.
3. Present a consolidated report, ranked by severity.
4. The user decides whether to address findings or proceed.
5. Draft the PR title and description, including a short summary of the review results, and create the PR on the user's confirmation.

## Layers

### Agnostic (always runs)

**Deterministic**
- Secret scanning (gitleaks, if installed; fallback pattern scan otherwise)
- Sensitive file names committed (`.env` but not `.env.example`, SSH private keys, `.pem`/`.pfx` and similar, credentials JSON)
- Merge-conflict markers
- Debug leftovers (`console.log`, `debugger`, Python `print`, `.only` in tests)
- Added suppressions (`@ts-ignore`, `eslint-disable`, `as any`, `# type: ignore`, `# noqa`); `@ts-expect-error` is allowed in tests
- Weakened tests: skipped tests added, test cases removed (net), test files deleted
- Source changed with no test change, when the repository has tests (cleanup hint only)
- Large or binary files added
- Generated output committed (`out/`, `dist/`, `coverage/`)
- JSON and YAML syntax; duplicate JSON keys; duplicate `id` values within one JSON array
- Line-ending consistency
- Relative links in changed Markdown files that point at missing files
- Manifest changed without its lockfile (for example, `package.json` without `pnpm-lock.yaml`)
- Portability (Windows editing, Linux running): CRLF in shell scripts, Makefiles and Dockerfiles; scripts with a shebang but no executable bit; paths that differ only by letter case
- Commit hygiene, `--full` only: no `fixup!`, `squash!`, `amend!` or WIP commits in a PR

**Agentic: general reviewer**
- Does the change do what its commits claim?
- Design and structure, naming, error handling
- Missing or inadequate tests
- Documentation that is now out of date

### TypeScript / React

**Deterministic**
- `tsc` type checking (project command; `tsc --noEmit` fallback when no project command type-checks)
- Tests (project command, e.g. Vitest)
- ESLint with typescript-eslint (type-aware rules) and eslint-plugin-react-hooks
- knip: unused files, exports and dependencies
- dependency-cruiser: package and layer boundaries
- `pnpm audit` / `npm audit`: known-vulnerable dependencies
- Custom Electron security check: `contextIsolation`, `nodeIntegration: false`, validation of IPC payloads

**Agentic: TypeScript reviewer**
- Type soundness: `any`, unchecked casts, non-null assertions, unvalidated external data
- React: hook rules and dependencies, unnecessary re-renders, state ownership
- Electron: main/preload/renderer separation and IPC security
- Async correctness: unhandled promises, race conditions

### JSON content packs

**Deterministic**
- Schema validation and pack integrity (project command, e.g. `make check`)
- Duplicate `id` values within one array (built-in, generic). ID naming conventions are project-specific and belong in the project's own check.

**Agentic: content reviewer**
- Conformance with the project's authoring guide
- Modeling correctness: lockouts, conditions, references
- Consistency and factual plausibility

### Shell and containers

**Deterministic**
- `bash -n` syntax check of `.sh`/`.bash` files and extensionless scripts with a sh/bash shebang (Git for Windows' bash on Windows)
- shellcheck, if installed
- `docker compose config -q` for changed Compose files; uses the committed `.env.example` when no `.env` exists, which also checks that the template covers every required variable
- hadolint for Dockerfiles, if installed

**Agentic:** the general reviewer's infrastructure checklist (ports, secrets, persistence, privilege, pinning).

### Lower priority

- PowerShell: PSScriptAnalyzer
- Markdown: markdownlint
- CSS: Stylelint

## Tool configuration

Linters and analyzers need configuration and installed packages in each project. The plugin will:
- Prefer the project's own tool configuration whenever it exists.
- Ship baseline configurations in `configs/` that a setup command can copy into a project.
- Only run tools the project has installed. Missing tools are reported as skipped coverage, not silently ignored.

## Severity

| Level | Meaning | Default handling |
|---|---|---|
| Bug | Incorrect behavior, data loss, security vulnerability | Recommend fixing before push or merge |
| Risk | Likely to cause problems; fragile or unsafe pattern | Recommend fixing or explicitly accepting |
| Cleanup | Maintainability, clarity, dead code | Optional |
| Nit | Style or preference | Optional; omit when there are many higher findings |

Deterministic failures (type errors, test failures, lint errors) are treated as Bug or Risk according to the tool's own severity.

## Known gaps

- Pushes or PRs made outside Claude (terminal, GitHub.com) are not reviewed. A GitHub Actions workflow for the deterministic layer is a possible later addition.
- RouteMancer has no linter today. Introducing ESLint will produce a backlog. The review script lints only changed files to contain this.
- Tools that take file names (ESLint, markdownlint, shellcheck, hadolint, PSScriptAnalyzer) are run without a shell, so file names are passed verbatim. Project commands and fixed-argument tools still run through the shell.
- Static Electron rules cannot see validation inside called functions. They report leads; the TypeScript reviewer confirms or dismisses each one.
- The baseline tool configs in `configs/` have not yet been run against a real project; `/review-setup` should verify them on first use.

## Structure (v0.1)

```
hypear-baseline/
├── skills/
│   ├── code-review/        # orchestrates the full review
│   └── pre-push/           # push decision criteria and deterministic run
├── agents/
│   ├── reviewer-general.md
│   ├── reviewer-typescript.md
│   └── reviewer-content.md
├── scripts/
│   ├── review.mjs          # entry point: scope, checks, report
│   ├── lib/                # git scope, project command discovery, process helpers
│   ├── checks/             # agnostic, electron, portability, shell, commits
│   └── test/               # node --test suite
├── configs/typescript/     # ESLint, knip, dependency-cruiser baselines
└── commands/
    ├── review.md
    ├── pr.md
    └── review-setup.md
```

## Possible next steps

- Run `/review-setup` on RouteMancer to add ESLint, knip and dependency-cruiser.
- GitHub Actions workflow for the deterministic layer, for pushes made outside Claude.
- Additional language layers (Python, Go, etc.) as new projects need them.
