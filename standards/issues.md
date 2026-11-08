## GitHub issues

A project's own issue templates or conventions win where they differ.

**When to create one:** only when the user asks, or as part of a planning step the user requested. Never as a side effect of other work. Before creating, search open issues (`gh issue list --search`); if a duplicate exists, show it to the user and ask whether to comment on it instead.

**Title:** sentence case, no trailing period, at most 72 characters. State the problem or the outcome; imperative mood is not required.

**Body:** exactly these sections, in this order:
1. `## Problem`: what is wrong or missing, and why it matters. For a bug, include what happens, what should happen, the steps to reproduce, and the versions involved.
2. `## Proposal`: what to change. For an open question, the options and a recommendation.
3. `## Acceptance`: how to tell the issue is done.
4. `## Depends on`: other issues as a list of `#N`. Omit if there are none.

**Labels:** exactly one of `bug`, `enhancement`, `documentation` or `question`. If the label does not exist in the repository, create the issue without it and tell the user.

**Linking:** reference issues and PRs as `#N`, or `owner/repo#N` for another repository, never by description alone. PRs resolve issues with `Closes #N`; changelog entries cite them as `(#N)`.

Do not rewrite existing issues to this format unless asked.
