# Changelog

All notable changes to `see-crets` will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.1] - 2026-04-07

### Fixed
- Replace cmdkey probe with CredRead sentinel; add DPAPI file fallback

---

## [0.1.0] - 2026-04-07

### Added
- Add skills for PRD creation and management
- Add PRD for `see-crets` tool to manage secrets for AI agents
- Add initial project plan for `see-crets` tool with architectural decisions and phases
- Walking skeleton — Windows CLI vault (issue #2) (#10)
- Phase 3 injection & scrubbing security core
- Phase 4 - automatic env var mapping via env-map.ts
- Cross-platform vault backends (macOS + Linux) (#12)
- Slice 5 - Secret Lifecycle (delete, purge, rotate + namespace fix) (#13)
- Tier 3 runtime hooks & plugin manifests (Slice 7)
- Add OpenCode native plugin (Tier 2, Slice 6) (#15)
- Add --version / -v flag to CLI (#29)
- See-crets uninstall command (#30)
- Install.sh — macOS/Linux one-liner installer (#32)
- Add see-crets upgrade command (self-update) (#33)
- Install.ps1 — Windows PowerShell installer (#35)

### Fixed
- Install.ps1 PS7+ compat and error handling (#36)
- Wave3 post-merge review findings (asset names, checksums, musl) (#37)
- IsMusl injectable lddRunner + defer musl detection to Linux branch
- Fail closed on vault error — prevent secret leakage to LLM (#46) (#60)
- Batch bug fixes — 13 issues (#38 #40 #41 #42 #43 #45 #47 #48 #50 #51 #53 #55 #56)
- Align install.sh first-run `set` example with CLI interactive behavior (#62)
- Replace inline Tera if-else with block conditional in cliff.toml footer

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

[0.1.1]: https://github.com/yldgio/see-crets/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/yldgio/see-crets/releases/tag/v0.1.0
