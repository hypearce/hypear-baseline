## Versioning

Versions follow [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) with these rules. The `changelog` and `release` skills and `scripts/changelog.mjs` / `scripts/release.mjs` implement them; a project's own release documentation wins where it differs.

- **Before 1.0:** every release is `1.0.0-pre.N`. The first release is `1.0.0-pre.1`, and each release adds 1 to N, whatever the changes. No `0.y.z` versions and no other suffixes (`alpha`, `beta`, `rc`). A repository with older `0.y.z` releases continues at `1.0.0-pre.1`.
- **1.0.0:** released only when the user says the project is stable. Never move to 1.0.0 on your own judgment.
- **After 1.0:** bump from the last release according to the `Unreleased` changelog entries. Bumping resets lower components.
  - MAJOR: any breaking change (an entry marked `**Breaking:**`) or any `Removed` entry.
  - MINOR: any `Added` or `Deprecated` entry.
  - PATCH: only `Changed` (non-breaking), `Fixed` or `Security` entries.
  - A larger bump than required is allowed; a smaller one is not. No pre-release suffixes after 1.0.
- **Breaking changes** are always marked `**Breaking:**` in the changelog, including before 1.0, where the version number does not signal them.
- **Tags** are `v<version>` (`v1.0.0-pre.3`, `v1.2.0`). GitHub releases of `1.0.0-pre.N` are marked as pre-releases.
- **Version declarations** (`package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `pyproject.toml`, `VERSION`) always equal the latest released version, and change only in a release commit.
