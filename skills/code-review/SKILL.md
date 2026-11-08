---
name: code-review
description: The user's full code review process (deterministic checks plus agent reviewers by language). Use when asked to review code, a diff, a branch or a PR, before creating a pull request, or before declaring a change finished.
---

# Code review

A full review has two layers: deterministic checks first, then agent reviewers whose input includes the deterministic results. Report findings; do not change code unless the user asks. The exception is auto-fix findings (step 4b), which you apply without asking.

## 1. Determine scope

- **Before a PR / reviewing a branch:** the branch's commits against its base (`--base <base branch>`).
- **Reviewing current work:** committed and uncommitted changes (`--working`).
- **A specific file or path the user names:** review that path; still run step 2 for the surrounding change if there is one.

## 2. Deterministic layer

```
node "<plugin root>/scripts/review.mjs" --full [--base <ref>] [--working]
```

The plugin root is listed under "Review tooling" in the hypear-baseline section of your instructions. `--full` adds the whole-source Electron scan, knip, the dependency audit, the commit hygiene check (no `fixup!`, `squash!` or WIP commits) and the commit subject checks (at most 72 characters, no trailing period; see `<plugin root>/standards/commits.md`). Keep the Markdown output; the reviewers need it.

If it exits `2` (could not run), report why and continue with the agent layer, noting that deterministic coverage is missing.

## 3. Agent layer

Launch these subagents **in parallel**, giving each: the scope (base ref or paths), the changed-file list, and the full deterministic report.

| Agent | When |
|---|---|
| `reviewer-general` | Always |
| `reviewer-typescript` | Languages include `typescript` |
| `reviewer-content` | Languages include `json` and the project defines content data validated by schemas or a project check (for example, a RouteMancer pack) |

For other languages with no dedicated reviewer, the general reviewer covers them.

## 4. Consolidate

Merge all findings into one report:
- Remove duplicates; keep the most specific version.
- Deterministic leads that a reviewer confirmed or dismissed: keep the reviewer's verdict.
- Rank by severity: **Bug**, **Risk**, **Cleanup**, **Nit**. Omit nits when there are more than a few higher findings.
- Keep auto-fix findings separate; step 4b decides which ones to apply.

## 4a. Verify bugs before reporting

Reviewer agents produce false positives. For each **Bug** that came from an agent (not from a failing tool), read the cited code yourself and confirm the problem exists as described: the code path is reachable, the input can occur, and nothing elsewhere already handles it. Then:
- Confirmed: keep it.
- Plausible but unproven: downgrade to **Risk** and mark it uncertain.
- Not reproducible from the code: drop it, and mention the drop in one line under Coverage.

## 4b. Apply auto-fixes

Auto-fix is for low-stakes fixes only. Apply a fix without asking only when it meets **all** of these (details and examples: `<plugin root>/docs/review-design.md`, section "Auto-fix"):

1. No behavior change: not runtime code paths, test logic, configuration, dependencies, generated files, public APIs or data formats.
2. Unambiguous: the meaning of the fix is clear from the finding; no decision about intent or design. Wording may vary, but the meaning may not (shortening a commit subject qualifies; changing what it says does not).
3. Within the change under review: only the commits or changed lines in scope.
4. Not security-relevant.
5. Confident: a deterministic `autofix` finding, or an agent `Auto-fix` finding with high confidence that you confirmed by reading the cited location.

An agent finding labeled `Auto-fix` that fails any criterion is reported at its normal level (usually Cleanup or Nit). Deterministic findings under **Auto-fix** in the report already meet the criteria.

Apply commit message fixes first, then file edits. After applying, rerun the deterministic layer. Leave file edits uncommitted in the working tree. Every applied fix must appear in the report's **Auto-fixed** section (step 5); an auto-fix that is not reported is not allowed.

If the project documents its own commit convention (for example in `CONTRIBUTING.md`) and it conflicts with a commit subject finding, report the finding as a Nit instead of fixing it. Projects with a commitlint configuration are already skipped by the check.

**Commit message fixes.** For each commit, write the complete new message to a file in your scratchpad: the corrected subject, then the original body and trailers unchanged (`git log -1 --format=%B <hash>`). Then reword all of them in one call:

```
node "<plugin root>/scripts/reword.mjs" --base <base ref> <hash>=<message file> [<hash>=<message file> ...] --json
```

The script rewords in place on the existing merge-base, keeps merge commits, stashes and restores uncommitted changes, and verifies that the tree is unchanged and the subjects match. On any failure it leaves the branch as it was and exits non-zero; then report the finding at its normal level instead of fixing it. Its output marks each commit that was already pushed: say in the report that the next push replaces those remote commits with `--force-with-lease`, which the pre-push skill also reports before pushing.

## 5. Report format

```
## Review: <scope>

**Result:** <n> bugs, <n> risks, <n> cleanups, <n> auto-fixed. <one-sentence overall assessment>

### Bugs
- `file:line`: <problem>. **Fix:** <concrete fix>.

### Risks
...

### Auto-fixed
- `file:line` or `commit <hash>`: <what changed>: "<before>" → "<after>". (Found by: <check or reviewer>)
- Uncommitted file edits: <list, or "none">. Reworded commits already pushed: <list, or "none">; the next push needs `--force-with-lease`.

### Coverage
- Ran: <deterministic checks that ran>; reviewers: <agents used>
- Not covered: <skipped checks and why>
```

Only report what was checked. Mark uncertain findings as such. The **Auto-fixed** section is required whenever any fix was applied; omit it only when there were none. If nothing is wrong, say so in one line plus the coverage section (and the Auto-fixed section, if any).

## Severity

| Level | Meaning |
|---|---|
| Bug | Incorrect behavior, data loss, security vulnerability |
| Risk | Likely to cause problems; fragile or unsafe pattern |
| Cleanup | Maintainability, clarity, dead code |
| Nit | Style or preference |
| Auto-fix | Low-stakes fix meeting every criterion in step 4b; applied, then reported |
