## Commit messages

A project's own commit convention (for example, Conventional Commits) wins where it differs.

**Subject**
- Imperative mood, sentence case, no trailing period, at most 72 characters.
- Describe the effect ("Add rollback to make deploy"), not the activity ("Updated Makefile").
- No type prefixes such as `feat:` unless the project uses them.

**Body**
- Optional for trivial changes. Otherwise: a blank line, then why the change was made and what the diff does not show. Wrap at 72 characters.
- Reference issues: `Closes #N` for an issue the commit resolves, `Refs #N` otherwise.

**Trailers**
- Last, after a blank line. Use the attribution lines from Claude Code's session instructions as given; this standard adds none.
- Never put a personal email address in a trailer or a commit identity.

**Scope**
- One logical change per commit. No `WIP`, `fixup!`, `squash!` or `amend!` commits on a branch going into a pull request.

**Generated commits:** `scripts/release.mjs` writes `Release vX`, which follows these rules.
