---
name: changelog
description: How the user maintains CHANGELOG.md (Keep a Changelog 1.1.0). Use when asked to create or update a changelog or add an entry, and when finishing a user-visible change in a repository that has a CHANGELOG.md. Releasing is the release skill.
---

# Changelog

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Version numbers follow the "Versioning" section of your hypear-baseline instructions (`<plugin root>/standards/versioning.md`). A project's own CLAUDE.md wins where it differs.

This skill edits `CHANGELOG.md` only. Cutting a release (dated version section, version declarations, tag, GitHub release) belongs to the release skill. Do not commit unless the user asks.

## When

- **Record changes:** add `Unreleased` entries as part of any user-visible change in a repository that has a `CHANGELOG.md`, without being asked.
- **Create a changelog:** only when asked. Do not backfill history from git unless asked.

## Script

```
node "<plugin root>/scripts/changelog.mjs" <command> [--json]
```

| Command | Effect |
|---|---|
| `init` | Create `CHANGELOG.md` with the standard header and an empty `Unreleased` section |
| `add <Type> <text>` | Add a bullet to `Unreleased` under the type, creating the group in canonical order; `**Breaking:**` entries go first |
| `lint` | Validate the format (findings with line numbers) |
| `status` | Last release, `Unreleased` entry count, the next version and why, version declarations and whether they match |
| `notes <version>` | Print a version's section |

Exit codes: `0` ok, `1` findings or refused, `2` usage error. Use `add` for new entries and finish with `lint`. Edit the file directly only to reword, merge or remove existing entries, then `lint` again.

## File format

What `init` writes, and what `lint` enforces:
- `# Changelog`, the standard intro, then `## [Unreleased]` as the first section, always present.
- Releases newest first: `## [1.0.0-pre.2] - 2026-11-03`, ISO 8601 dates; yanked releases keep their section with ` [YANKED]` appended. Never delete a released section.
- Inside a section, only `### <type>` groups with `- ` bullets (continuation lines indented), in this order: `Added` (new features), `Changed` (changes in existing functionality), `Deprecated` (soon-to-be removed features), `Removed` (now removed features), `Fixed` (bug fixes), `Security` (vulnerabilities). No empty groups.
- If the file has version link definitions at the bottom, every section has one. The release script maintains them.

## Writing entries

The changelog is for people using the project, not a commit log.

- One bullet per notable change, as a sentence ending with a period. Describe the effect a user sees, not the implementation: "Exports now include the route's notes." rather than "Refactor export serializer."
- Combine related commits into one entry. Leave out changes with no user-visible effect: refactors, internal tests, CI, formatting, dependency bumps that change nothing for users.
- What counts as user-visible depends on the project. For a Claude Code plugin, skills, agents, commands, standards and scripts are all behavior; a change to a skill's instructions is a `Changed` entry.
- Breaking changes: start the bullet with `**Breaking:**` and say what the user must do to migrate. The type decides the next version (see Versioning), so classify carefully: a removal is `Removed`, not `Changed`.
- Deprecations: name the replacement and, if known, the version that removes it.
- Security: name the affected versions and the CVE or advisory when one exists.
- Reference issues or PRs when they exist (`(#42)`). Do not invent them.
- Before adding, read the current `Unreleased` entries: update or merge an entry rather than duplicating it, and remove an entry whose change was reverted before release.
- Correcting history is allowed (for example, marking a missed breaking change). Say what was corrected.
