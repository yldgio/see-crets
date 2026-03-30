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
- Bugs in **see-crets' integration with** OS vault backends — e.g. incorrect API usage, missing error handling, or misuse of Keychain/Credential Manager/libsecret APIs that could expose secret values

### Out of Scope

- Vulnerabilities **in the underlying OS vault implementations themselves** (Keychain, Credential Manager, libsecret, pass) — report those to Apple, Microsoft, or your Linux distribution vendor
- Issues requiring physical access to the machine
- Social engineering the user to reveal secrets manually
- Secrets disclosed via a separate, unrelated application on the same machine

---

## Core Security Invariant

Every code change must preserve this invariant:

> **The LLM sees key names only. Secret values exist in-process for the duration of one subprocess call, then are gone.**

Any change that could violate this invariant — even in an edge case — should be flagged in the PR description and reviewed carefully.

---

## Install Script Trust Model

When you run the one-liner installer, two distinct artifacts are in play: the install script and the binary it downloads. This section explains the trust chain for each.

### The install script

The install script (`install.sh` / `install.ps1`) is served directly from the `main` branch of this repository:

```
https://raw.githubusercontent.com/yldgio/see-crets/main/install.sh
https://raw.githubusercontent.com/yldgio/see-crets/main/install.ps1
```

Both files are fully auditable — anyone can read them in the GitHub UI or download them without piping to a shell before deciding to run them.

**Compromise of the install script requires write access to the `main` branch**, which is branch-protected and requires pull-request review. A supply-chain attack via the install script is equivalent to compromising the repository itself.

### The binary

The binary is **not** served from `main`. It is downloaded from a pinned release tag:

```
https://github.com/yldgio/see-crets/releases/download/v{VERSION}/{asset}
```

The installer fetches `checksums.txt` from the **same release tag** and verifies the binary's SHA-256 hash before installing. A tampered binary that does not match the published checksum causes the installer to abort immediately.

### If you want additional assurance

1. **Inspect before running** — download the script first, review it, then run the local copy:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/yldgio/see-crets/main/install.sh -o install.sh
   cat install.sh   # read it
   bash install.sh  # then run it
   ```

2. **Use the version-pinned form** — the `VERSION` variable pins the binary download and checksum verification to a specific release tag you can verify in the [Releases](https://github.com/yldgio/see-crets/releases) page. The install script itself is always fetched from `main`; for full script immutability, download and inspect it first (option 1 above):

   ```sh
   VERSION=0.1.0 curl -fsSL https://raw.githubusercontent.com/yldgio/see-crets/main/install.sh | bash
   ```

3. **Download the binary directly** — skip the install script entirely, download the binary from [GitHub Releases](https://github.com/yldgio/see-crets/releases), and verify its SHA-256 against `checksums.txt` manually:

   ```sh
   # Example for macOS arm64
   curl -fsSL https://github.com/yldgio/see-crets/releases/download/v0.1.0/see-crets-macos-arm64 -o see-crets
   curl -fsSL https://github.com/yldgio/see-crets/releases/download/v0.1.0/checksums.txt -o checksums.txt
   shasum -a 256 --check <(grep 'see-crets-macos-arm64' checksums.txt)
   chmod +x see-crets
   ```
