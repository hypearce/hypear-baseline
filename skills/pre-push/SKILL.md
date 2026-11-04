---
name: pre-push
description: Decide whether to run deterministic checks before a git push, run them, and report. Use whenever you are about to run `git push`, or the user asks to push.
---

# Pre-push checks

Before running `git push`, decide whether to run the deterministic review. The user can override this decision in either direction ("push, skip checks" or "run checks first"); an explicit instruction always wins.

## 1. Decide

Look at what the push sends: `git log --oneline @{u}..HEAD` and `git diff --stat @{u}..HEAD` (for a new branch, compare against the default branch).

**Run the checks** if the commits include any of:
- Source code changes
- Dependency manifest or lockfile changes
- Build, CI, lint or tooling configuration changes
- Content or data files that a project check validates (for example, a RouteMancer pack)

**Skip the checks** if the commits contain only:
- Documentation or comment changes
- Changes the checks already passed on in this session, with no commits since

**Ask the user** if the case is unclear, for example:
- A large or mixed change where the risk is hard to judge
- Changes to generated or vendored files
- The project's checks are known to be slow and the change is small

When asking, state the recommendation and the reason in one sentence, for example: "This push changes one TypeScript file and the README. I recommend running the checks (about 5 seconds). Run them?"

### Push safety (independent of the checks)

- **Rewritten history:** if the push needs to overwrite the remote branch, use `git push --force-with-lease`, never `--force`, and tell the user which remote commits will be replaced. `--force-with-lease` refuses if someone else pushed in the meantime.
- **Default branch:** if the push targets the repository's default branch (usually `main`) directly, say so before pushing. Push only if the user asked for it or the repository's own instructions allow it; otherwise propose a branch.
- **Releases:** the release commit pushed by `scripts/release.mjs` follows the release skill instead of this one.

## 2. Run

```
node "<plugin root>/scripts/review.mjs"
```

The plugin root is listed under "Review tooling" in the hypear-baseline section of your instructions. Run it from the repository. It reviews the commits being pushed (upstream..HEAD) and runs the project's own commands (`make test`, `make check`, package scripts) plus any installed tools.

Exit codes: `0` pass (possibly with warnings), `1` blocking failures, `2` the review could not run.

## 3. Act on the result

- **Pass:** push.
- **Pass with warnings:** summarize the risk-level findings in one or two lines, then push. If a warning looks serious (for example, a possible credential), ask first.
- **Fail:** do not push. Report the blocking findings with `file:line`, and ask whether to fix them or push anyway.
- **Could not run:** report the error and ask whether to push without checks.

## 4. Report

After every push, state in one line whether the checks ran and the result, or that they were skipped and why. Examples:
- "Pushed 3 commits to origin/dev. Checks passed (make test, built-in checks)."
- "Pushed 1 commit to origin/dev. Checks skipped: documentation-only change."
