---
description: Run the full review, then draft and create a pull request after confirmation
argument-hint: "[base branch]"
---

Prepare a pull request for the current branch.

1. **Base:** use `$ARGUMENTS` if given; otherwise the repository's default branch. If the branch has unpushed commits, tell me; pushing follows the pre-push skill.
2. **Review:** run the full review with the hypear-baseline code-review skill against that base. Present the consolidated report.
3. **Decide:** if there are bugs or risks, ask whether to address them before continuing. Do not fix anything without my answer.
4. **Draft:** write the PR title and description:
   - Title: concise, imperative, matching the repository's commit style.
   - Description: what changed and why, notable design decisions, how it was tested, and a short **Review** section (result counts, checks that ran, anything accepted rather than fixed).
5. **Confirm:** show me the draft. Create the PR with `gh pr create` only after I confirm.
