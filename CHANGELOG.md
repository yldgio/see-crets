# Changelog

All notable changes to `see-crets` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Slice 7 — Tier 3 Runtime Hooks & Plugin Manifests**
  - `plugin.json` at repo root: Copilot CLI plugin manifest wiring SKILL.md, tool-guard hooks, and pre-secrets hooks in one install step
  - `hooks/pre-secrets.sh` / `hooks/pre-secrets.ps1`: shared PreToolUse hooks for Copilot CLI and Claude Code — block OS vault CLI calls, resolve `{{SECRET:key}}` placeholders, auto-inject mapped vault keys, and scrub secret values from tool output
  - `hooks/hooks.json`: documentation descriptor for the `hooks/` directory
  - `src/tools/inject-command.ts`: `see-crets inject` CLI subcommand (internal hook IPC — resolves placeholders and auto-injects vault keys into a command string)
  - `src/tools/scrub-output-command.ts`: `see-crets scrub-output` CLI subcommand (internal hook IPC — redacts vault values from stdin before returning to runtime)
- **Vault CLI blocking rules** in `hooks/tool-guard/policy.json`: macOS `security` commands (find-generic-password, find-internet-password, find-certificate, dump-keychain, interactive mode), Windows cmdkey/vaultcmd, Linux libsecret/pass, 1Password CLI, KDE Wallet, and internal `see-crets inject`/`scrub-output` commands
- **Claude Code wiring** in `.claude/settings.json`: pre-secrets hooks registered for Bash and PowerShell matchers alongside existing tool-guard hooks

### Added
- Full architectural design spec (`see-crets-design.md`)
- Product requirements document with 32 user stories
- 8-phase implementation plan
- Project scaffolding (AGENTS.md, .gitignore, .gitattributes, skills)

---

<!-- Template for future releases:

## [X.Y.Z] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes in existing functionality

### Deprecated
- Soon-to-be removed features

### Removed
- Removed features

### Fixed
- Bug fixes

### Security
- Security fixes — always list these first when present

-->

[Unreleased]: https://github.com/yldgio/see-crets/compare/HEAD...HEAD
