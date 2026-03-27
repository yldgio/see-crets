# PRD: CLI Distribution & Agent Install Skill

> **Pre-mortem reviewed** — this PRD incorporates findings from a structured failure-tree analysis.

## Problem Statement

As a user of see-crets, I want to install the CLI without cloning the repository.
Today the only path is `git clone` + `bun build` — requiring Bun, a clone, and manual PATH wiring.
There is no one-liner install, no binary download, no agent skill that teaches an AI assistant how to set see-crets up.
This blocks adoption and makes it painful to onboard the tool in new environments or CI pipelines.

## Solution

Publish pre-built, self-contained binaries to GitHub Releases on every version tag.
Provide two installer scripts — `install.sh` (macOS/Linux) and `install.ps1` (Windows) — that detect the current platform, download the right binary, verify its SHA256 checksum, and place it on PATH.
Fall back to a local `bun build` when Bun is present and a binary for the current platform isn't available.
Extend `SKILL.md` with a complete install section so any AI agent (Copilot CLI, Claude Code, OpenCode) can guide a user through installation and vault wiring end-to-end.
Add `see-crets upgrade` and `see-crets uninstall` CLI commands for full lifecycle management.
Introduce git-cliff for automated CHANGELOG generation from conventional commits, with a defined version bump workflow.

## User Stories

1. As a developer on macOS, I want to install see-crets with a single `curl | sh` command, so that I don't need to clone the repository or install Bun.
2. As a developer on Linux (x64 or arm64), I want the same one-liner to work on my machine, so that the install experience is identical across platforms.
3. As a developer on Windows, I want a single `irm | iex` PowerShell command that installs the CLI, so that I can get started without additional tooling.
4. As a developer, I want the installer to place the binary somewhere writable without admin/sudo rights, so that I can install on managed machines.
5. As a developer, I want the installer to add the binary to my PATH automatically (or tell me how), so that `see-crets` is immediately usable in a new shell.
6. As a developer, I want to choose a custom install prefix (`--prefix /usr/local/bin`), so that I can control where the binary lives.
7. As a developer, I want to pin to a specific release version (`VERSION=1.2.3 curl | sh`), so that my install is reproducible.
8. As a developer, I want the installer to verify the SHA256 checksum of the downloaded binary, so that I can trust the artifact wasn't tampered with.
9. As a developer with Bun installed, I want the installer to fall back to `bun build` if no prebuilt binary matches my platform, so that I'm never left without a working install.
10. As a developer, I want to upgrade to the latest version by re-running the one-liner, so that I don't need to manage the binary manually.
11. As a CI pipeline maintainer, I want the install script to work in a non-interactive environment (no prompts), so that I can add see-crets to automated workflows.
12. As an AI agent (Copilot CLI / Claude Code / OpenCode), I want a skill section in SKILL.md that tells me exactly how to install and configure see-crets, so that I can guide users without hallucinating steps.
13. As an AI agent, I want the skill to tell me how to detect the current OS and arch, so that I recommend the right install command.
14. As an AI agent, I want the skill to tell me how to wire all three tiers (Tier 1 env vars, Tier 2 env-map, Tier 3 hooks) after install, so that users get a fully working setup.
15. As an AI agent, I want the skill to tell me how to verify a successful install (binary on PATH, vault functional), so that I can confirm setup before moving on.
16. As an AI agent, I want the skill to cover migration from a `.env` file to vault keys, so that users can transition existing secrets.
17. As an AI agent, I want the skill to explain the upgrade path, so that I can keep users on the latest release.
18. As a developer, I want the install scripts to be idempotent, so that running them a second time doesn't break an existing install.
19. As a developer, I want clear error messages when a download fails or a checksum doesn't match, so that I can diagnose the problem quickly.
20. As a maintainer, I want GitHub Actions to build and publish seven platform binaries (including musl variants) and a `checksums.txt` file automatically when I push a version tag, so that releases are consistent and reproducible.
21. As a developer on Alpine Linux or a musl-based Docker image, I want a compatible binary, so that see-crets works in containerized CI environments.
22. As a developer, I want to run `see-crets upgrade` to update to the latest release in place, so that I don't need to remember the install one-liner.
23. As a developer, I want to run `see-crets uninstall` to cleanly remove the binary and its PATH entry, so that removal is as simple as installation.
24. As a developer, I want `see-crets --version` to print the current version, so that I can verify installs and report issues accurately.
25. As a maintainer, I want a `cliff.toml` configuration so that git-cliff automatically generates the CHANGELOG from conventional commits on each release, eliminating manual CHANGELOG maintenance.
26. As a maintainer, I want a documented version bump workflow (`bun version` + `git cliff` + tag push), so that releases are consistent and reproducible.

## Implementation Decisions

### Binary Build & Release

- **Seven** build targets produced by `bun build --compile`:
  - `see-crets-macos-arm64`
  - `see-crets-macos-x64`
  - `see-crets-linux-x64` (glibc — Ubuntu, Debian, Fedora, etc.)
  - `see-crets-linux-x64-musl` (musl — Alpine, minimal Docker images)
  - `see-crets-linux-arm64` (glibc)
  - `see-crets-linux-arm64-musl` (musl)
  - `see-crets-windows-x64.exe`
- The install script detects musl systems via `/etc/alpine-release` or `ldd --version` output.
- A `checksums.txt` file containing `sha256  <filename>` lines is generated and uploaded alongside the binaries.
- Release workflow triggers on `push` to tags matching `v*.*.*`.
- Each binary and `checksums.txt` are uploaded as GitHub Release assets.
- The release workflow is separate from the CI workflow (`release.yml` vs `ci.yml`).
- The Bun version used for release builds is pinned (not `latest`) in `release.yml` to guarantee reproducible binary output.

### Install Script: install.sh (macOS / Linux)

- Single script hosted at a stable URL (e.g. `https://raw.githubusercontent.com/<org>/see-crets/main/install.sh`).
- Detects OS (`uname -s`) and architecture (`uname -m`); detects musl via `/etc/alpine-release` or `ldd --version`; maps to the correct asset name.
- Resolves the version to download: `VERSION` env var if set, otherwise queries the GitHub Releases API for the latest tag. If the API call fails (rate-limit or network error), the script exits with: *"Could not detect latest version. Set VERSION=x.y.z and retry."*
- Downloads the binary and `checksums.txt` from GitHub Release assets.
- Verifies SHA256 using `sha256sum` (Linux) or `shasum -a 256` (macOS). Exits non-zero with a clear error if the checksum does not match.
- On macOS, removes the `com.apple.quarantine` extended attribute after install (`xattr -d com.apple.quarantine "$dest" 2>/dev/null || true`) to prevent Gatekeeper from blocking first execution. Requires no admin rights.
- Default install prefix: `~/.local/bin` (created if absent, no sudo required). `PREFIX` env var or `--prefix <path>` flag overrides the default. For CI/global installs: `PREFIX=/usr/local/bin curl | sh`.
- If `~/.local/bin` is not on PATH, the script prints the exact line to add, tailored to the detected shell (bash, zsh, fish). It does not modify profile files automatically.
- Sets executable bit on the binary.
- Idempotent: replaces an existing binary at the target path.
- Non-interactive: no prompts; all decisions driven by env vars and flags.
- Ends with a structured post-install message:
  ```
  ✅ see-crets vX.Y.Z installed → ~/.local/bin/see-crets

  Next steps:
    1. Reload shell or run: export PATH="$HOME/.local/bin:$PATH"
    2. Set your first secret:  see-crets set my-project/github-token
    3. Agent install guide:    https://github.com/<org>/see-crets/blob/main/SKILL.md
  ```

### Install Script: install.ps1 (Windows)

- Equivalent PowerShell script hosted at the same stable path.
- Invoked via `PowerShell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/<org>/see-crets/main/install.ps1 | iex"`. The execution policy bypass is required on default Windows configurations and must be documented prominently.
- Compatible with **Windows PowerShell 5.1** and PowerShell 7+ (no null-coalescing `??`, null-conditional `?.`, or ternary operators — aligns with existing codebase hook script convention).
- Detects architecture from `$env:PROCESSOR_ARCHITECTURE` / `$env:PROCESSOR_ARCHITEW6432`.
- Downloads `see-crets-windows-x64.exe` and verifies SHA256 with `Get-FileHash`. Exits with a clear error if the checksum does not match.
- Default install directory: `$env:USERPROFILE\.see-crets\bin` (user-scoped, no admin required, consistent with Unix `~/.local/bin` philosophy). `-Prefix <path>` parameter overrides the default.
- Adds the install directory to the user's `PATH` via `[Environment]::SetEnvironmentVariable("PATH", …, "User")` — writes to `HKCU`, no elevation needed.
- Prints a clear message that a new terminal session is required for PATH changes to take effect.
- Idempotent: overwrites an existing binary.
- Ends with the same structured post-install message as install.sh (adapted for Windows paths).

### Fallback: Local Build

- If the detected platform has no prebuilt binary (e.g. unsupported arch) and `bun` is on PATH, the install script runs `bun build ./src/cli.ts --compile --outfile ./dist/see-crets` from a shallow clone of the repo.
- If neither a binary nor Bun is available, the script exits with a clear error message pointing to the manual install docs.

### New CLI Commands: upgrade, uninstall, --version

- **`see-crets --version`**: Prints the current version string (read from `package.json` at build time via Bun's `import` of JSON). Required for install verification and bug reports.
- **`see-crets upgrade`**: Queries the GitHub Releases API for the latest tag; compares with the current version; if newer, downloads the binary for the current platform, verifies SHA256, and replaces the running binary in place. Prints a diff of old → new version. Fails gracefully if offline or rate-limited.
- **`see-crets uninstall`**: Removes the binary at its current path (resolved via the running executable's path). Optionally removes the install directory from PATH (asks for confirmation, or accepts `--yes` flag). Does not touch vault data — uninstalling the CLI does not delete secrets.

### Changelog Automation: git-cliff

- **Tool**: [git-cliff](https://git-cliff.org/) — a Rust binary with zero Node.js dependency, driven by a `cliff.toml` config file in the repository root.
- **Format**: Outputs in Keep a Changelog format (consistent with the existing `CHANGELOG.md`).
- **GitHub Action**: `orhun/git-cliff-action` generates the CHANGELOG in the release workflow, embedding the changelog body in the GitHub Release description.
- **cliff.toml** is committed to the repo root and configures conventional commit parsing.

### Version Bump Workflow

The canonical release process:

```sh
# 1. Bump version in package.json and create a version commit + tag
bun version patch   # or minor / major

# 2. Generate the CHANGELOG section for the new tag
bunx cliff generate --tag "$(node -p "require('./package.json').version" | sed 's/^/v/')"

# 3. Amend the version commit to include the updated CHANGELOG
git add CHANGELOG.md && git commit --amend --no-edit

# 4. Re-tag the amended commit (the original tag must be deleted and recreated)
VERSION=$(node -p "require('./package.json').version")
git tag -d "v$VERSION" && git tag "v$VERSION"

# 5. Push commit + tag — triggers release.yml
git push && git push --tags
```

This ensures the release tag always points to a commit tree that contains the CHANGELOG for that version.
The workflow is documented in `CONTRIBUTING.md`.

### Install Path Design Rationale

The default install paths differ intentionally by platform — this is a deliberate UX decision, not an oversight:

| Platform | Default path | Why |
|----------|-------------|-----|
| Linux / macOS | `~/.local/bin` | XDG Base Directory standard. Ubuntu 22.04+, Fedora 36+, and Arch add this to PATH automatically when the directory exists. Following the convention means most users on modern distros get a zero-friction install with no PATH modification. |
| Windows | `$env:USERPROFILE\.see-crets\bin` | No equivalent XDG convention exists on Windows. `%LOCALAPPDATA%\Programs` is the closest standard but ties into Apps & Features and LOCALAPPDATA cleanup policies on managed machines. A user-namespaced path under `USERPROFILE` is safer on enterprise/managed Windows. |

**Why not use `~/.see-crets/bin` on Linux/macOS too (for cross-platform consistency)?**
Consistency is a nice-to-have; reducing friction is a requirement. Using a custom namespace on Linux/macOS would force a manual PATH edit on every user, including the majority on modern Ubuntu/Fedora where `~/.local/bin` is already wired. The Windows path was *forced* by the absence of a convention; on Unix, the convention exists and should be followed.

Both paths are always overridable via `PREFIX` / `--prefix`.

### Trust Model

The install script is served from the `main` branch raw URL. The trust model is:
- The **script** can be audited by anyone before running.
- The **binaries** are downloaded from a pinned release tag (not `main`) and verified with SHA256.
- Any compromise of the install script requires write access to the `main` branch.

This trust model is documented in `SECURITY.md`.

### GitHub Actions: release.yml

- Trigger: `on: push: tags: ['v*.*.*']`
- Matrix strategy: one job per target platform, each running on the appropriate runner OS. arm64 Linux binaries are cross-compiled on ubuntu-latest using `--target bun-linux-arm64` and `--target bun-linux-arm64-musl` (no native arm64 runner needed).
- Each job: checks out the repo, installs Bun at a **pinned version**, runs `bun build --compile --target <target>`, uploads the binary as a workflow artifact.
- A final job downloads all artifacts, generates `checksums.txt`, runs `orhun/git-cliff-action` to generate release notes from conventional commits, creates the GitHub Release with that body, and uploads all files.
- The release workflow reuses the same build command as the existing `ci.yml` build step.

### SKILL.md Extension

A new section `## Installing see-crets` is added to `SKILL.md` covering:

- **detect_os**: How to identify the current OS and architecture to select the right install command.
- **run_install**: The exact one-liner for each platform (macOS/Linux `curl`, Windows `irm | iex`), plus version-pinning syntax.
- **verify_install**: `see-crets --version` and `see-crets list` smoke test to confirm the binary is working.
- **wire_tier1**: Setting `SEE_CRETS_PROJECT` and using `see-crets set` to populate initial secrets.
- **wire_tier2**: Configuring the env-map for automatic env-var injection (pointing agents at `SKILL.md` Tier 2 section).
- **wire_tier3**: Registering the pre-secrets hook for the active runtime (Copilot CLI, Claude Code, OpenCode).
- **migrate_env**: Pattern for reading a `.env` file and importing each key via `see-crets set`.
- **`upgrade`**: Using `see-crets upgrade` command (self-updating, verifies SHA256) instead of re-running the install one-liner.

### README Update

The Quick Start section of `README.md` is updated to show the one-liner install commands ahead of the `git clone` path. The `git clone` path is retained as a "development install" option.

## Testing Decisions

Good tests for this feature verify observable external behavior, not internal implementation details.

**What makes a good test here:**
- Test the install scripts in isolated environments (containers or VMs) to verify they produce a working binary at the expected path.
- Test the release workflow by triggering it on a test tag and asserting that all five assets and `checksums.txt` are present in the release.
- Test the checksum verification by providing a corrupted binary and asserting that the script exits non-zero with an error message.

**Modules to test:**
- `install.sh` — integration tests via a matrix of Docker images (ubuntu:24.04, ubuntu:24.04 musl/Alpine, ubuntu:22.04-arm64, macos runner). Assert: binary on PATH, `see-crets --version` exits 0.
- `install.ps1` — integration test on a Windows runner. Assert: binary in `$env:USERPROFILE\.see-crets\bin`, PATH updated, `see-crets --version` exits 0.
- `release.yml` — workflow test via `workflow_dispatch` on a release-candidate tag. Assert: seven binaries + `checksums.txt` uploaded.
- Checksum failure path — unit test in CI: download a binary, corrupt it, run verifier, assert non-zero exit.
- `see-crets upgrade` — unit test: mock GitHub API response for newer version, assert binary replacement and old-version cleanup.
- `see-crets uninstall` — unit test: assert binary removed, PATH entry gone.

**Prior art:** The existing `ci.yml` matrix (Windows/Ubuntu/macOS) provides the runner configuration pattern to follow for the release and install integration tests.

## Out of Scope

- **npm / npx distribution**: No `bin` field in `package.json`, no `npm publish`. The Bun standalone binary model makes npm packaging complex and the fallback build path covers Bun users already.
- **Homebrew / Scoop / apt / winget tap**: Packaging managers require separate maintenance; deferred to a future release.
- **Auto-update daemon**: No background update checker. `see-crets upgrade` is the explicit, user-initiated upgrade path.
- **Code signing / notarization**: macOS Gatekeeper signing and Windows Authenticode signing are deferred. The install script mitigates the macOS quarantine attribute via `xattr`; users may still need to approve via System Preferences on older macOS versions.
- **Container image**: A Docker image (`ghcr.io/…/see-crets`) is out of scope for this PRD.
- **npm `npx see-crets` support**: Deferred; the shell-script model is simpler and avoids a Node.js dependency.

## Further Notes

- The stable install URL uses the `main` branch raw URL so it always points to the latest script without requiring a redirect service. The security tradeoff (script served from mutable branch) is documented in `SECURITY.md`.
- The `VERSION` env var pinning mechanism (`VERSION=1.2.3 curl | sh`) follows the convention used by mise, Deno, and Bun itself.
- macOS users on Apple Silicon receive the `macos-arm64` binary by default; Intel Mac users receive `macos-x64`. A universal binary is not required.
- The install scripts print a structured post-install message with 3 actionable next steps (shell reload, first secret, agent guide link). This information is also the basis for the SKILL.md install section.
- Windows PowerShell execution policy is a known friction point; all install documentation prominently shows the `-ExecutionPolicy Bypass` invocation.
- The `SKILL.md` install section is self-contained: an agent with no prior context can read it and guide a user through full installation and vault wiring without referencing other documentation.
