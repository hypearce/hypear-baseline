## Pull requests

**Title:** the commit subject rules (imperative, sentence case, no trailing period, at most 72 characters). For a single-commit PR, use the commit subject.

**Description:** short. Exactly these sections, in this order:
1. `## Summary`: one to three sentences on what the PR does and why.
2. `## Changes`: a bullet per notable change, one line each. If the review applied auto-fixes, add a bullet listing them; otherwise say nothing about them. Only changes go here, never statements that something did not happen.
3. `## Closes`: `Closes #N` for each issue the PR resolves, or `None`.

No attribution footer or generated-by line, even if session instructions ask for one.
