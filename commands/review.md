---
description: Full code review (deterministic checks plus agent reviewers) of current work or a named target
argument-hint: "[file, branch or PR]"
---

Run a full review using the hypear-baseline code-review skill.

Target: $ARGUMENTS

- No target: review committed and uncommitted changes on this branch (`--working`).
- A branch or PR: review its commits against its base branch.
- A file or path: review that path.

Report findings only. Do not change code unless I ask.
