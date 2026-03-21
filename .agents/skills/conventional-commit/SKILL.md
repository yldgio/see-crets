---
name: conventional-commit
description: 'Prompt and workflow for generating conventional commit messages using a structured XML format. Guides users to create standardized, descriptive commit messages in line with the Conventional Commits specification, including instructions, examples, and validation.'
---

### Instructions

Follow these steps:
1. Run `git status` to review changed files.
2. Run `git diff` or `git diff --cached` to inspect changes.
3. Stage your changes with `git add <file>`.
4. Construct your commit message using the structure below.
5. Run: `git commit -m "type(scope): description"`

### Commit Message Structure

```
type(scope): description

[optional body]

[optional footer]
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

**Types:** `feat` | `fix` | `docs` | `style` | `refactor` | `perf` | `test` | `build` | `ci` | `chore` | `revert`

### Examples

```
feat(vault): add Windows Credential Manager backend
fix(inject): handle missing SECRET placeholder gracefully
docs: update README with Tier 3 enforcement setup
chore: add .gitignore and repo scaffolding
feat!: rename secret key path format (BREAKING CHANGE)
```

### Validation

- **type**: required, must be from the list above
- **scope**: optional but recommended
- **description**: required, imperative mood ("add" not "added")
- **body**: optional, extra context
- **footer**: use for breaking changes (`BREAKING CHANGE: ...`) or issue refs
