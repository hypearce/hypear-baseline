---
name: debugging
description: The user's debugging approach. Use when investigating a bug, error, crash, failing test or unexpected behavior.
---

# Debugging

1. **Reproduce** the problem first. Get the exact error and the steps.
2. **Read** the relevant code and recent changes before guessing.
3. **Form a hypothesis**, then test it with the smallest check that would prove it wrong.
4. **Fix the root cause**, not the symptom. No retry loops or sleeps to hide problems.
5. **Verify** the fix with the original repro, and add a test if the project has tests.
6. **Report** the cause in one or two plain sentences, plus what changed.
