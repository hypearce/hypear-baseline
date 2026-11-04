# Developer commands for hypear-baseline. Run from the repository root.
# On a machine without make, run scripts/setup.ps1 directly first:
#   powershell -NoProfile -ExecutionPolicy RemoteSigned -File scripts/setup.ps1

.DEFAULT_GOAL := help
.PHONY: help setup test check

help:
	@echo make setup - Check the tools this repository needs and offer to install missing ones
	@echo make test  - Run the test suites
	@echo make check - Validate CHANGELOG.md

# Check for Git, Node.js, make, the GitHub CLI and gitleaks; offers to install
# missing ones with winget, asking before each install.
# Tools are listed in scripts/setup.ps1.
ifeq ($(OS),Windows_NT)
setup:
	powershell -NoProfile -ExecutionPolicy RemoteSigned -File scripts/setup.ps1
else
setup:
	@echo setup supports Windows only. Install git, Node.js 20 or later, make, gh and gitleaks with your package manager.
	@exit 1
endif

test:
	node --test scripts/test/review.test.mjs scripts/test/release.test.mjs

check:
	node scripts/changelog.mjs lint
