## Coding standards

- Match the existing style and patterns of the codebase before introducing new ones.
- Clear names over clever code. Functions do one thing; keep them short.
- Handle errors at the boundary where something can actually be done about them. Don't swallow errors silently.
- No dead code, commented-out code, or unused imports.
- Comments explain *why*, not *what*. Keep them concise and written in professional technical language.
- Don't add dependencies without a good reason; prefer the standard library.
- Keep secrets out of code and out of logs.
- New behavior gets a test when the project has tests.
