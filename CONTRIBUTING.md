# Contributing to see-crets

Thank you for your interest in contributing! This document explains how to get involved, what to work on, and what we expect from contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Workflow](#development-workflow)
- [Commit Messages](#commit-messages)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Security](#security)

---

## Code of Conduct

This project is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it. Please report unacceptable behavior to the maintainers.

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- Git
- One of: macOS (Keychain), Windows (Credential Manager), or Linux (libsecret or `pass`)

### Setup

```bash
git clone https://github.com/yldgio/see-crets
cd see-crets
bun install
```

### Run the test suite

```bash
bun test
```

### Build the CLI binary

```bash
bun run build
```

---

## How to Contribute

### Reporting Bugs

1. Search [existing issues](https://github.com/yldgio/see-crets/issues) first to avoid duplicates.
2. Use the **Bug Report** issue template and fill in all fields.
3. Include your OS, Bun version, and the runtime you're using (OpenCode / Copilot CLI / Claude Code).
4. **Do not report security vulnerabilities as issues** — see [SECURITY.md](SECURITY.md).

### Suggesting Features

1. Check the [roadmap in README.md](README.md#roadmap) to see if it's already planned.
2. Open a [Feature Request](https://github.com/yldgio/see-crets/issues/new?template=feature_request.yml) with a clear problem statement and proposed solution.

### Picking Up Work

- Issues labeled [`good first issue`](https://github.com/yldgio/see-crets/labels/good%20first%20issue) are ideal for newcomers.
- Issues labeled [`help wanted`](https://github.com/yldgio/see-crets/labels/help%20wanted) are open for community contributions.
- Comment on the issue before starting work to avoid duplicate effort.

---

## Development Workflow

1. **Fork** the repository and clone your fork.
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   # or
   git checkout -b fix/my-bug
   ```
3. **Write tests** alongside your implementation when test infrastructure exists.
4. **Run checks** before pushing:
   ```bash
   bun test
   bun run lint
   bun run build
   ```
5. **Push** your branch and open a pull request.

---

## Commit Messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <short description>

[optional body]

[optional footer(s)]
```

**Types:**

| Type | When to use |
|------|------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code restructuring (no behavior change) |
| `test` | Adding or fixing tests |
| `chore` | Build, tooling, or config changes |
| `security` | Security-related changes |

**Examples:**

```
feat(vault): add macOS Keychain backend
fix(scrub): handle secrets shorter than 8 chars correctly
docs: add Tier 2 installation instructions
security(hook): prevent secret values from leaking into error messages
```

---

## Pull Request Guidelines

- **One PR per concern.** Don't bundle unrelated changes.
- **Link the issue** your PR addresses: `Closes #123`.
- **Fill in the PR template** — description, testing notes, checklist.
- **Keep PRs small and reviewable.** Large PRs take longer to review and are harder to revert.
- **Security-sensitive code** (vault backends, hook scripts, output scrubbing) requires extra scrutiny — add tests and call out the security implications in your PR description.
- **CI must pass** before a PR will be reviewed.

### Checklist (auto-added to PR template)

- [ ] Tests added or updated
- [ ] Documentation updated if behavior changed
- [ ] `bun run lint` passes
- [ ] `bun test` passes
- [ ] No secrets or credentials in the diff

---

## Security

`see-crets` is a security-sensitive project. The core invariant — **LLMs see key names only, never values** — must be preserved by every change.

If you find a security vulnerability:
1. **Do not open a public issue.**
2. Follow the process in [SECURITY.md](SECURITY.md).

When reviewing your own PRs for security impact, ask:
- Could this change cause a secret value to appear in a tool response, log, or error message?
- Could this change write a secret value to disk, even temporarily?
- Could this change export a secret value into the process environment beyond the lifetime of a single subprocess?

If the answer to any of these is "yes" or "maybe," flag it explicitly in the PR description.

---

## Questions?

Open a [Discussion](https://github.com/yldgio/see-crets/discussions) or comment on a relevant issue. We're happy to help.
