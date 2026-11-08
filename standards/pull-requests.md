## Pull requests

**Title:** the commit subject rules (imperative, sentence case, no trailing period, at most 72 characters). For a single-commit PR, use the commit subject.

**Description:** these sections, in this order:
1. `## What changed`
2. `## Why`
3. `## Design decisions` (omit when there are none)
4. `## Testing`: what was run, and what was not verified
5. `## Review`: result counts, checks run, auto-fixes applied, and findings accepted rather than fixed

Then a `Closes #N` line for each issue the PR resolves, then the attribution footer.
