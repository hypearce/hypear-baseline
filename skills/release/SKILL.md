---
name: release
description: The user's release process - release commit on main, push, and GitHub release, driven by scripts/release.mjs. Use only when the user asks to release, cut or publish a version, or create a GitHub release.
---

# Release

A release does exactly three things, from `main` only:
1. A release commit that changes `CHANGELOG.md` (the `Unreleased` entries become a dated version section) and the version declarations, and nothing else.
2. A push of that commit to `origin/main`.
3. A GitHub release `v<version>`, which creates the tag, with the version's changelog section as its notes.

Versions follow the "Versioning" section of your hypear-baseline instructions (`<plugin root>/standards/versioning.md`). Entry format follows the changelog skill.

Run only when the user asks for a release. If the project's instructions or your memory say not to commit, push or touch GitHub in this repository, point that out and ask before going further.

## Script

```
node "<plugin root>/scripts/release.mjs" plan [--version X]
node "<plugin root>/scripts/release.mjs" run --version X --co-author "<attribution>"
node "<plugin root>/scripts/release.mjs" publish --version X
```

- `plan` checks and prints the plan; it changes nothing. Without `--version` it computes the next version.
- `run` re-checks, then writes the changelog and version declarations, commits `Release vX` (the subject the commit standard prescribes for releases), pushes `main` and creates the GitHub release. If anything fails before the commit, it restores the files.
- `publish` creates only the GitHub release, for a release commit already on `origin/main` (recovery after a failed `run`).
- Exit codes: `0` ok, `1` checks or a step failed, `2` usage error or not a git repository. Add `--json` for structured output.

The checks: on `main`; no uncommitted changes except to `CHANGELOG.md`; `HEAD` equal to `origin/main` after a fetch; origin on GitHub; `gh` installed and signed in; changelog committed and lint-clean; `Unreleased` not empty; version allowed by the rules; version declarations equal to the last release; tag and GitHub release not already present.

## Procedure

1. **Plan.** Run `plan`. If it is blocked, report the failed checks and stop. Do not work around a check: switching branches, pulling, stashing or committing other work are the user's calls. If `gh` is missing: `winget install GitHub.cli`, then `gh auth login`.
2. **Check the entries.** Compare `Unreleased` with what changed since the last release: `git log --oneline v<last>..HEAD` (the whole history for a first release). Add missing user-visible changes, merge duplicates, fix types, and make sure breaking changes carry `**Breaking:**`. Use the changelog skill's rules. Leave these edits uncommitted; the release commit includes them. Rerun `plan` if you changed anything, because the type of an entry can change the version.
3. **Confirm.** Show the user the version and reason, the release notes, and what will happen: one commit pushed directly to `main`, and a GitHub release (marked pre-release before 1.0). Wait for an explicit yes. For `1.0.0` itself, also confirm that they are declaring the project stable. The confirmation authorizes the direct push to `main`; the pre-push skill's checks do not apply to the release commit, because `plan` already required `main` to be pushed.
4. **Run.** `run --version <confirmed version> --co-author "<the Co-Authored-By value from your commit attribution instructions>"`. Pass the version from the plan, so a change between plan and run is refused rather than released.
5. **Report** in one or two lines: the version, the commit, the release URL. If `run` failed, relay its message. It states what was done and the recovery command; do not improvise one (in particular, never delete a tag or release, and never force-push).

## Never

- Release from any branch other than `main`, or from a `HEAD` that differs from `origin/main`.
- Change files other than `CHANGELOG.md` and the version declarations in the release commit.
- Create or move tags by hand, or edit a published GitHub release, unless the user asks.
- Choose `1.0.0` without the user saying so.
