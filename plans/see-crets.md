# Plan: see-crets

> Source PRD: `prds/see-crets.md`

## Architectural Decisions

Durable decisions that apply across all phases:

- **CLI binary**: `see-crets` — Bun/TypeScript, single executable, universal interface for all runtimes
- **No MCP in v1**: Tools exposed as `see-crets <command>` subcommands callable by LLMs via bash
- **Secret namespace**: `{git-root-basename}/{key}` or `global/{key}` — zero config, auto-detected from git
- **Storage backends**: OS-native vault only — macOS Keychain · Windows Credential Manager · Linux libsecret → pass
- **Injection**: two strategies active simultaneously — placeholder substitution (`{{SECRET:key}}`) + subprocess-scoped env vars (never `export`)
- **Scrubbing**: min 8 chars, substring match, values replaced with `[REDACTED]` before LLM sees output
- **Enforcement tiers**: Skill (behavioral) → Plugin (structural) → Hooks (enforced + scrubbing)
- **Runtimes**: OpenCode (native TS `tool()` plugin) · Copilot CLI · Claude Code (shared hooks + SKILL.md)
- **Shared hook files**: `hooks/hooks.json`, `hooks/pre-secrets.sh`, `hooks/pre-secrets.ps1` — identical for Claude Code and Copilot CLI; only manifests differ
- **Core security invariant**: The LLM sees key names only. Values exist in-process only, for the duration of one subprocess call.

---

## Phase 1: Walking Skeleton — Set + List on Current OS

**User stories**: 1, 2, 5, 8, 27, 28

### What to build

The thinnest complete path through the system: a working CLI that can store a secret via masked input, list key names, and report vault health — all on the developer's current OS (Windows). This establishes the project structure, build pipeline, and Tier 1 behavioral guidance (`SKILL.md`) in one demoable slice.

Covers: `package.json` (Bun config, `see-crets` binary entry), `src/vault/detect.ts` (OS detection), `src/vault/windows.ts` (Credential Manager + DPAPI), `src/tools/ask-secret-set.ts`, `src/tools/secrets-list.ts`, `src/tools/secrets-detect.ts`, `src/cli.ts` (wires `set`, `list`, `detect` commands), `SKILL.md` (Tier 1 — drop-in behavioral guidance, no install required).

### Acceptance criteria

- [ ] `bun run build` (or `bun build`) produces a standalone `see-crets` binary
- [ ] `see-crets set <key>` prompts for a value with native masked input and stores it in Windows Credential Manager
- [ ] `see-crets list` returns key names only (no values) for the current project namespace and `global/`
- [ ] `see-crets detect` reports the active vault backend and health status
- [ ] No secret value appears in any CLI output or return value
- [ ] `SKILL.md` exists at the repo root and covers the three LLM-callable commands
- [ ] Tests: vault store/retrieve/list operations against a mock Windows backend; `ask-secret-set` returns `{stored: true, key: "..."}` with value absent from response

---

## Phase 2: Cross-Platform Vault Backends

**User stories**: 30, 31, 32

### What to build

Add the remaining two OS backends so `see-crets` works on macOS and Linux. `detect.ts` already selects the right backend at runtime — this phase fills in the implementations. Linux requires a fallback chain: try libsecret first, then `pass` (GPG store), hard-error if neither is available.

Covers: `src/vault/macos.ts` (Keychain via `security` CLI), `src/vault/linux.ts` (libsecret via `secret-tool` + `pass` fallback), `detect.ts` updated to route all three OS targets.

### Acceptance criteria

- [ ] `see-crets detect` correctly identifies the active backend on macOS, Windows, and Linux
- [ ] On Linux, if libsecret is unavailable but `pass` is installed, `pass` is used automatically with no user prompt
- [ ] On Linux, if neither libsecret nor `pass` is available, `see-crets` exits with a clear error (not a silent failure)
- [ ] `see-crets set / list / detect` produce identical external behavior across all three OS targets
- [ ] Tests: all three backends exercise store, retrieve, list, delete via mocked CLI calls; Linux fallback chain tested with both backends mocked as unavailable/available in sequence

---

## Phase 3: Injection & Scrubbing (Security Core)

**User stories**: 12, 14, 15, 16, 17

### What to build

The security heart of the system. Two components: `inject.ts` resolves `{{SECRET:key}}` placeholders in agent-generated commands and builds the subprocess env map (values exist only for the duration of one subprocess call, never exported to the session). `scrub.ts` scans tool output for any resolved secret value and replaces it with `[REDACTED]` before the LLM sees it.

Covers: `src/hook/inject.ts` (placeholder substitution + subprocess env map builder), `src/hook/scrub.ts` (output redaction).

### Acceptance criteria

- [ ] `{{SECRET:my-app/github-token}}` in a command string is resolved to the actual value before the subprocess is spawned
- [ ] The resolved value is injected as a subprocess-scoped env var (`VAR=value command`) — never via `export` or session env mutation
- [ ] After subprocess exit, the value is not accessible from the session env
- [ ] Any resolved secret value appearing in subprocess stdout/stderr is replaced with `[REDACTED]`
- [ ] Values shorter than 8 characters are NOT redacted (no false positives on short strings)
- [ ] A secret value embedded inside a longer string (e.g. inside a JSON blob or URL) is still redacted (substring match)
- [ ] Multiple occurrences of the same value in one output are all redacted
- [ ] Tests: inject resolves placeholders correctly; inject does not mutate session env; scrub handles embedded values, short values, multiple occurrences

---

## Phase 4: Env Var Mapping

**User stories**: 23, 24, 25, 26

### What to build

Extend the injection layer (Phase 3) with two mapping sources: a built-in map of ~20 well-known key-name → env-var-name pairs, and a per-project `.see-crets.json` override file that is safe to commit (contains mappings only, never values). The inject hook uses both sources to automatically inject the right env var names for tools that read from the environment (e.g. `gh` reads `GITHUB_TOKEN`).

Covers: built-in env map embedded in `inject.ts`, `.see-crets.json` parsing and merge logic, `.see-crets.json.example` at repo root.

Built-in map includes (at minimum): `github-token → GITHUB_TOKEN`, `azure-devops-pat → AZURE_DEVOPS_PAT`, `database-url → DATABASE_URL`, `npm-token → NPM_TOKEN`, `docker-password → DOCKER_PASSWORD`, `aws-access-key-id → AWS_ACCESS_KEY_ID`, `aws-secret-access-key → AWS_SECRET_ACCESS_KEY`, `openai-api-key → OPENAI_API_KEY`, `anthropic-api-key → ANTHROPIC_API_KEY`, `slack-token → SLACK_TOKEN`, and ~10 more common tools.

### Acceptance criteria

- [ ] Storing `my-app/github-token` and running a `gh` command causes `GITHUB_TOKEN` to be injected automatically without any placeholder syntax
- [ ] A `.see-crets.json` at the git root can map `my-custom-key → MY_ENV_VAR` and that mapping is honored
- [ ] `.see-crets.json` override takes precedence over the built-in map for the same key name
- [ ] `.see-crets.json` is validated on load — a missing or malformed file produces a clear error, not a silent failure
- [ ] `.see-crets.json.example` exists at the repo root with annotated examples
- [ ] Tests: built-in map resolves correctly; per-project override overrides; malformed `.see-crets.json` errors cleanly

---

## Phase 5: Secret Management & Namespace

**User stories**: 3, 4, 6, 7, 13

### What to build

Complete the secret lifecycle: `delete`, `purge`, and `rotate` commands for human-initiated management. Add proper git-root detection: project namespace is derived from `git rev-parse --show-toplevel | basename`; outside a git root, `global/` is used silently and the LLM is informed via the tool response.

Covers: `see-crets delete <key>`, `see-crets purge`, `see-crets rotate <key>` in `cli.ts` and matching `src/tools/` logic; git root detection utility; global namespace fallback with informational LLM message.

### Acceptance criteria

- [ ] `see-crets delete <key>` removes a secret from the OS vault and confirms deletion
- [ ] `see-crets purge` removes all secrets for the current project namespace and confirms
- [ ] `see-crets rotate <key>` prompts for a new value (masked) and updates the existing vault entry without a delete/re-add
- [ ] `see-crets set / list` automatically use the git-root-derived project namespace when inside a git repo
- [ ] When outside a git repo, commands use `global/` and the response includes an informational note (e.g. `"namespace": "global", "note": "No git root found — operating in global namespace"`)
- [ ] The LLM-facing tool schema does NOT expose `delete`, `purge`, or `rotate` — these are CLI-only
- [ ] Tests: git root detection returns correct project name; global fallback returns correct namespace + note; rotate updates value without deleting the key entry

---

## Phase 6: OpenCode Native Plugin (Tier 2)

**User stories**: 9, 10, 11, 19, 23

### What to build

The OpenCode-specific integration: a native TS plugin that wraps the shared `src/tools/` logic in `tool()` helpers from `@opencode-ai/plugin`. The plugin registers the three LLM-callable tools (`ask_secret_set`, `secrets_list`, `secrets_detect`) directly into the OpenCode tool schema, and uses the `shell.env` hook to inject env vars into every OpenCode tool call automatically — so tools like `gh` get `GITHUB_TOKEN` without any placeholder syntax.

Covers: `src/runtimes/opencode.ts` (exports a `Plugin` function, registers `tool()` wrappers, binds `tool.execute.before` and `shell.env` hooks).

### Acceptance criteria

- [ ] Installing the plugin in `.opencode/plugins/` makes `ask_secret_set`, `secrets_list`, and `secrets_detect` available as native OpenCode tools
- [ ] `ask_secret_set` triggers the masked input flow — the value never appears in the tool call arguments or response
- [ ] `secrets_list` returns key names only; calling it from OpenCode produces the same result as `see-crets list` from the CLI
- [ ] The `shell.env` hook injects stored secrets as env vars into every OpenCode tool call that spawns a subprocess, using the env var mapping from Phase 4
- [ ] The plugin does not require MCP — it uses OpenCode's native plugin API only
- [ ] Tests: tool registrations are verified; `shell.env` hook injects correct env vars; `ask_secret_set` response contains no value field

---

## Phase 7: Tier 3 Runtime Hooks & Plugin Manifests

**User stories**: 18, 20, 21, 22, 29

### What to build

The enforcement layer that makes secret protection robust even against a misbehaving agent. Shared hook files (`hooks.json`, `pre-secrets.sh`, `pre-secrets.ps1`) run before every tool call on both Claude Code and Copilot CLI: they resolve placeholders, inject env vars, and scrub output. A tool-guard rule blocks direct OS vault CLI calls (`security`, `cmdkey`, `secret-tool`, `pass`). Plugin manifests wire everything together for both runtimes.

Covers: `hooks/hooks.json` (shared; points to `.sh` / `.ps1` by OS), `hooks/pre-secrets.sh` (bash: placeholder resolution + env injection + scrubbing), `hooks/pre-secrets.ps1` (PowerShell: same logic for Windows), `plugin.json` (Copilot CLI manifest), `.claude-plugin/plugin.json` (Claude Code manifest).

### Acceptance criteria

- [ ] Installing the Copilot CLI plugin (`copilot plugin install ./`) activates `SKILL.md`, hooks, and tool-guard in one step
- [ ] Installing the Claude Code plugin (`claude --plugin-dir ./`) activates the same `SKILL.md`, hooks, and tool-guard in one step
- [ ] `hooks/hooks.json`, `hooks/pre-secrets.sh`, and `hooks/pre-secrets.ps1` are identical between the two runtimes — only the manifests differ
- [ ] A `{{SECRET:key}}` placeholder in an agent-generated command is resolved before execution by the pre-secrets hook
- [ ] A direct call to `security find-generic-password` (macOS), `cmdkey /list` (Windows), or `secret-tool lookup` (Linux) is blocked by the tool-guard hook with an explanatory error
- [ ] Any secret value that appears in tool output is scrubbed to `[REDACTED]` by the post-execution scrub step
- [ ] Tests: hook scripts parse and resolve placeholders correctly; tool-guard patterns block exact and variant CLI invocations; scrub step applied to hook output

---

## Phase 8: Documentation & Distribution

**User stories**: 27, 28 (remainder)

### What to build

`README.md` covering installation and usage for all three enforcement tiers across all three runtimes. The goal is that a developer can land on the README and go from zero to a working Tier 3 installation in under 10 minutes. Also verifies the final build and binary packaging.

Covers: `README.md` (install guide for Tier 1 / Tier 2 / Tier 3 × OpenCode / Copilot CLI / Claude Code; CLI reference; `.see-crets.json` config reference; security model explainer), final `bun build` verification producing a distributable binary.

### Acceptance criteria

- [ ] `README.md` has a clear "Quick Start" for each tier (Tier 1: drop `SKILL.md`; Tier 2: install plugin; Tier 3: install plugin + hooks)
- [ ] Each runtime section (OpenCode / Copilot CLI / Claude Code) has explicit install commands
- [ ] The CLI command reference covers all public commands (`set`, `list`, `detect`, `delete`, `purge`, `rotate`) with args and example output
- [ ] The `.see-crets.json` config section shows the full schema with examples
- [ ] The security model section explains the core invariant (LLM sees key names only) and the three threat mitigations (placeholder substitution, subprocess-scoped env, output scrubbing)
- [ ] `bun build` produces a standalone binary with no runtime dependencies
- [ ] The binary runs on a clean machine without Bun installed
