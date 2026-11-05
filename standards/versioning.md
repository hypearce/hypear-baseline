## Versioning

Versions follow [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) with these rules. The `changelog` and `release` skills and `scripts/changelog.mjs` / `scripts/release.mjs` implement them; a project's own release documentation wins where it differs.

- **Before 1.0:** every release is `0.MINOR.PATCH-pre`, and the first release is `0.1.0-pre`. MAJOR stays 0:
  - MINOR: any breaking change, `Removed`, `Added` or `Deprecated` entry. Bumping MINOR resets PATCH to 0.
  - PATCH: only `Changed` (non-breaking), `Fixed` or `Security` entries.
  - A larger bump than required is allowed; a smaller one is not. No other suffixes (`-pre.N`, `alpha`, `beta`, `rc`). A repository with plain `0.y.z` releases continues with the next `0.y.z-pre`.
  - A repository that already released under the earlier `1.0.0-pre.N` scheme keeps adding 1 to N until 1.0.0.
- **1.0.0:** released only when the user says the project is stable. Never move to 1.0.0 on your own judgment.
- **After 1.0:** bump from the last release according to the `Unreleased` changelog entries. Bumping resets lower components.
  - MAJOR: any breaking change (an entry marked `**Breaking:**`) or any `Removed` entry.
  - MINOR: any `Added` or `Deprecated` entry.
  - PATCH: only `Changed` (non-breaking), `Fixed` or `Security` entries.
  - A larger bump than required is allowed; a smaller one is not. No pre-release suffixes after 1.0.
- **Breaking changes** are always marked `**Breaking:**` in the changelog, including before 1.0, where they bump only MINOR.
- **Tags** are `v<version>` (`v0.3.1-pre`, `v1.2.0`). GitHub releases of pre-1.0 versions are marked as pre-releases.
- **Version declarations** (`package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `pyproject.toml`, `VERSION`) always equal the latest released version, and change only in a release commit.
