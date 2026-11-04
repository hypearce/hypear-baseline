---
name: code-review
description: The user's full code review process (deterministic checks plus agent reviewers by language). Use when asked to review code, a diff, a branch or a PR, before creating a pull request, or before declaring a change finished.
---

# Code review

A full review has two layers: deterministic checks first, then agent reviewers whose input includes the deterministic results. Report findings; do not change code unless the user asks.

## 1. Determine scope

- **Before a PR / reviewing a branch:** the branch's commits against its base (`--base <base branch>`).
- **Reviewing current work:** committed and uncommitted changes (`--working`).
- **A specific file or path the user names:** review that path; still run step 2 for the surrounding change if there is one.

## 2. Deterministic layer

```
node "<plugin root>/scripts/review.mjs" --full [--base <ref>] [--working]
```

The plugin root is listed under "Review tooling" in the hypear-baseline section of your instructions. `--full` adds the whole-source Electron scan, knip, the dependency audit and the commit hygiene check (no `fixup!`, `squash!` or WIP commits). Keep the Markdown output; the reviewers need it.

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

## 4a. Verify bugs before reporting

Reviewer agents produce false positives. For each **Bug** that came from an agent (not from a failing tool), read the cited code yourself and confirm the problem exists as described: the code path is reachable, the input can occur, and nothing elsewhere already handles it. Then:
- Confirmed: keep it.
- Plausible but unproven: downgrade to **Risk** and mark it uncertain.
- Not reproducible from the code: drop it, and mention the drop in one line under Coverage.

## 5. Report format

```
## Review: <scope>

**Result:** <n> bugs, <n> risks, <n> cleanups. <one-sentence overall assessment>

### Bugs
- `file:line`: <problem>. **Fix:** <concrete fix>.

### Risks
...

### Coverage
- Ran: <deterministic checks that ran>; reviewers: <agents used>
- Not covered: <skipped checks and why>
```

Only report what was checked. Mark uncertain findings as such. If nothing is wrong, say so in one line plus the coverage section.

## Severity

| Level | Meaning |
|---|---|
| Bug | Incorrect behavior, data loss, security vulnerability |
| Risk | Likely to cause problems; fragile or unsafe pattern |
| Cleanup | Maintainability, clarity, dead code |
| Nit | Style or preference |
