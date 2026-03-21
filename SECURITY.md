# Security Policy

## Supported Versions

`see-crets` is currently in pre-release development. Security fixes are applied to the `main` branch only.

| Version | Supported |
|---------|-----------|
| `main` (pre-release) | ✅ |
| Older commits | ❌ |

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Security bugs in `see-crets` are taken seriously. Since this project's entire purpose is to keep secret values out of AI agent context, a security vulnerability could expose credentials to unintended parties.

### How to Report

1. Navigate to the [Security tab](https://github.com/yldgio/see-crets/security) on GitHub.
2. Click **"Report a vulnerability"** to open a private security advisory.
3. Fill in as much detail as possible:
   - **Description**: What is the vulnerability?
   - **Impact**: What can an attacker do? Which secret values could be exposed?
   - **Affected component**: Which tier, runtime, OS platform, or vault backend?
   - **Steps to reproduce**: Minimal reproduction case if possible.
   - **Suggested fix**: Optional but appreciated.

### What Happens Next

- You will receive an acknowledgment within **48 hours**.
- We will investigate and aim to have a fix within **7 days** for critical issues.
- We will coordinate disclosure with you before any public announcement.
- Credit will be given in the release notes (unless you prefer to remain anonymous).

---

## Security Scope

### In Scope

The following are in scope for security reports:

- Any path that causes a **secret value** (not just the key name) to be returned to the LLM context
- Any path that writes a secret value to disk (plaintext or otherwise) within the project directory
- Any path that exports a secret value into the process environment beyond a single subprocess lifetime
- Output scrubbing bypasses — a secret value passing through to tool output unredacted
- Injection vulnerabilities in placeholder substitution (`{{SECRET:key}}`)
- OS vault backend vulnerabilities (Keychain, Credential Manager, libsecret/pass)

### Out of Scope

- Issues requiring physical access to the machine
- Vulnerabilities in underlying OS vault implementations (Keychain, Credential Manager) — report those to Apple/Microsoft/distribution vendors
- Social engineering the user to reveal secrets manually
- Secrets disclosed via a separate, unrelated application on the same machine

---

## Core Security Invariant

Every code change must preserve this invariant:

> **The LLM sees key names only. Secret values exist in-process for the duration of one subprocess call, then are gone.**

Any change that could violate this invariant — even in an edge case — should be flagged in the PR description and reviewed carefully.
