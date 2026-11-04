---
name: testing
description: How the user wants tests written and run. Use when writing, fixing or running tests, or adding test coverage.
---

# Testing

- Use the project's existing test framework and conventions. Don't add a new one.
- Test behavior, not implementation details.
- One clear reason to fail per test; descriptive test names.
- Cover the happy path, edge cases and at least one failure path.
- Keep tests fast and independent. Mock only true external boundaries (network, clock, filesystem when needed).
- Run the tests after writing them. Report the actual results, including failures.
- Never weaken or delete a test just to make it pass.
