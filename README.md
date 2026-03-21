# see-crets

> **OS-native secret vault for AI agents. LLMs see key names. Never values.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?logo=bun)](https://bun.sh)
[![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)]()
[![Status](https://img.shields.io/badge/status-pre--release%20%2F%20design%20phase-orange)]()

> **⚠️ Pre-release:** see-crets is in active design and early development. The architecture and CLI surface described below are finalised and implementation is underway — no release is available yet. Star or watch the repo to follow progress.

---

## The Problem

When you use an AI agent to do real work — deploying code, calling APIs, querying databases — you face an impossible choice:

- **Paste your secret into chat** → it ends up in the LLM context window, logs, and possibly training data.
- **Block the agent** → it can't do the work.

Neither is acceptable.

## The Solution

`see-crets` is a proxy between your AI agent and your OS secret vault. Secrets are stored in the OS-native keystore (Keychain on macOS, Credential Manager on Windows, libsecret/pass on Linux) and resolved only at subprocess execution time — never in the LLM context window.

```
┌──────────────┐     key names only     ┌────────────────┐     resolved value      ┌──────────────────┐
│  AI Agent    │ ──────────────────────▶ │   see-crets    │ ──────────────────────▶ │  OS Secret Vault │
│  (LLM)       │                         │   (hook/tool)  │                         │  (Keychain, etc) │
└──────────────┘                         └────────────────┘                         └──────────────────┘
                                                  │
                                    value injected into subprocess
                                    (never returned to LLM)
```

**The core invariant**: The LLM sees key names only. Secret values exist in-process for the duration of one subprocess call, then are gone.

---

## Planned Features

> These capabilities are designed and specified — implementation is in progress. See the [Roadmap](#roadmap) for phase status.

- 🔐 **OS-native storage** — Keychain (macOS), Credential Manager (Windows), libsecret/pass (Linux). No files written to disk.
- 🕵️ **Output scrubbing** — If a secret leaks into stdout/stderr, it will be replaced with `[REDACTED]` before the LLM sees it.
- 💉 **Two injection strategies** — Placeholder substitution (`{{SECRET:key}}`) and subprocess-scoped env injection (`VAR=value cmd`).
- 🧰 **Three runtimes** — OpenCode, GitHub Copilot CLI, Claude Code.
- 📈 **Graduated enforcement** — Start with a single Markdown file (Tier 1). Add a plugin (Tier 2). Add hooks for full enforcement (Tier 3).
- 🔑 **Auto-namespacing** — Secrets will be automatically scoped to your project via `git rev-parse --show-toplevel`.
- ⚙️ **Built-in env map** — 20+ common service keys (`github-token → GITHUB_TOKEN`, `openai-api-key → OPENAI_API_KEY`, etc.) with per-project overrides.

---

## Enforcement Tiers

| Tier | What You Install | Security Model | Best For |
|------|-----------------|---------------|----------|
| **Tier 1 — Skill** | Drop `SKILL.md` in your agent config | Behavioral (agent follows guidance voluntarily) | Quick personal setup |
| **Tier 2 — Plugin** | Skill + runtime plugin | Structural (vault access only via plugin; direct vault CLIs blocked) | Team projects |
| **Tier 3 — Full** | Skill + plugin + shell hooks | Enforced (hooks block direct vault CLIs; output scrubbing active) | Production / CI |

---

## Quick Start (planned)

> **Not yet released.** The steps below reflect the intended installation experience once the CLI is published. Follow the repo to be notified when v0.1 ships.

### Tier 1 — Skill only (2 minutes)

1. Clone or install `see-crets`:
   ```bash
   # Using bun (recommended)
   bun install -g see-crets

   # Or clone the repo
   git clone https://github.com/yldgio/see-crets
   ```

2. Copy the skill file to your agent's config directory:
   ```bash
   # GitHub Copilot CLI
   cp SKILL.md ~/.copilot/skills/see-crets.md

   # Claude Code
   cp SKILL.md ~/.claude/skills/see-crets.md

   # OpenCode
   cp SKILL.md ~/.opencode/skills/see-crets.md
   ```

3. Store your first secret:
   ```bash
   see-crets set github-token
   # Prompts: Enter value for 'my-project/github-token': ****
   ```

4. Ask your agent to use it — it will call `secrets_list` to discover what's available and `{{SECRET:github-token}}` placeholders to reference them in commands.

### Tier 2 — Plugin (adds structural enforcement)

Install the runtime plugin for your agent:

**OpenCode:**
```bash
cp -r .opencode/ ~/.opencode/plugins/see-crets/
```

**GitHub Copilot CLI:**
```bash
cp plugin.json ~/.copilot/plugins/see-crets.json
```

**Claude Code:**
```bash
cp -r .claude-plugin/ ~/.claude/plugins/see-crets/
```

### Tier 3 — Hooks (full enforcement + output scrubbing)

```bash
# macOS / Linux — adds pre-execution hook to your agent config
cp hooks/pre-secrets.sh ~/.config/agent-hooks/
cp hooks/hooks.json ~/.config/agent-hooks/

# Windows — PowerShell equivalent
cp hooks/pre-secrets.ps1 $env:APPDATA\agent-hooks\
cp hooks/hooks.json $env:APPDATA\agent-hooks\
```

---

## CLI Reference (planned)

> Commands below reflect the finalised CLI design. Implementation begins in Phase 1.

### `see-crets set <key>`

Store a secret in the OS vault. The value is always entered via masked terminal input — it is never echoed or logged.

```bash
see-crets set github-token
# Enter value for 'my-project/github-token': ****

see-crets set database-url --project my-app
# Stores under 'my-app/database-url' instead of the auto-detected project name
```

### `see-crets list [--project <name>]`

List key names (never values) for the current project and global namespace.

```bash
see-crets list
# my-project/github-token
# my-project/database-url
# global/npm-token
```

### `see-crets detect`

Report which OS backend is active and its health.

```bash
see-crets detect
# Backend: macOS Keychain (healthy)
# Project namespace: my-project (from git root)
```

### `see-crets delete <key>`

Remove a secret from the vault. Human-initiated only — not callable by agents.

```bash
see-crets delete github-token
```

### `see-crets purge`

Remove all secrets in the current project namespace. Irreversible.

```bash
see-crets purge
# Removes all keys under 'my-project/'
```

### `see-crets rotate <key>`

Update a secret's value without deleting and re-adding it.

```bash
see-crets rotate github-token
# Enter new value for 'my-project/github-token': ****
```

---

## Secret Namespaces

Secrets are organized in two namespaces:

| Namespace | Format | Purpose |
|-----------|--------|---------|
| **Project** | `{git-root-name}/{key}` | Auto-detected from `git rev-parse --show-toplevel` |
| **Global** | `global/{key}` | Shared across all projects (personal tokens, shared keys) |

```bash
see-crets set github-token              # → my-project/github-token (auto-detected)
see-crets set npm-token --global        # → global/npm-token
see-crets set db-pass --project staging # → staging/db-pass (explicit override)
```

---

## Injection Strategies (planned)

Two complementary methods will ensure secret values never reach the LLM.

### Strategy A — Placeholder Substitution

The agent writes `{{SECRET:key}}` in commands. The hook resolves the value before execution.

```bash
# Agent generates:
curl -H "Authorization: Bearer {{SECRET:github-token}}" https://api.github.com/repos

# Hook resolves before execution:
curl -H "Authorization: Bearer ghp_abc123..." https://api.github.com/repos
```

### Strategy B — Subprocess-Scoped Env Injection

The hook injects secrets as env vars scoped to a single subprocess. The session environment is never polluted.

```bash
# Stored key: github-token → maps to env var: GITHUB_TOKEN (built-in map)
# Hook executes as:
GITHUB_TOKEN=ghp_abc123... gh repo list
# Value dies with the subprocess.
```

Both strategies are active simultaneously. The hook also scrubs any secrets that appear in command output before returning results to the LLM.

---

## Built-in Env Var Map

Common service keys are automatically mapped to their conventional env var names:

| Key Name | Env Var |
|----------|---------|
| `github-token` | `GITHUB_TOKEN` |
| `azure-devops-pat` | `AZURE_DEVOPS_PAT` |
| `database-url` | `DATABASE_URL` |
| `npm-token` | `NPM_TOKEN` |
| `docker-password` | `DOCKER_PASSWORD` |
| `aws-access-key-id` | `AWS_ACCESS_KEY_ID` |
| `aws-secret-access-key` | `AWS_SECRET_ACCESS_KEY` |
| `openai-api-key` | `OPENAI_API_KEY` |
| `anthropic-api-key` | `ANTHROPIC_API_KEY` |
| `slack-token` | `SLACK_TOKEN` |

### Per-Project Override

Create `.see-crets.json` in your project root (safe to commit — no secrets inside):

```json
{
  "envMap": {
    "my-custom-token": "MY_TOKEN",
    "db-password": "PGPASSWORD"
  }
}
```

Project overrides take precedence over built-in mappings.

---

## OS Vault Backends

| OS | Backend | Auto-Detected |
|----|---------|--------------|
| macOS | Keychain | ✅ |
| Windows | Credential Manager (DPAPI) | ✅ |
| Linux | libsecret (preferred) → `pass` (fallback) | ✅ |

On Linux, `see-crets detect` tells you which backend is active and how to install the other if needed.

---

## Security Model

### Output Scrubbing Rules

- **Minimum length:** 8 characters (values shorter than 8 chars are not scrubbed to avoid false positives)
- **Match mode:** Substring — a secret embedded in JSON, URLs, or headers is still caught
- **Replacement:** `[REDACTED]`
- **Timing:** Applied before tool output is returned to the LLM

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| LLM reads secret values directly | Secrets never returned as tool output; key names only |
| Secrets leak through command output | Output scrubbing replaces values with `[REDACTED]` |
| Secrets in shell command strings | `{{SECRET:key}}` placeholder syntax; hook substitutes before execution |
| Secrets in git history | OS vault only; no secret files written to project directories |
| Session env contamination | `VAR=value cmd` syntax; values scoped to subprocess lifetime |

### What is NOT in scope for v1

- Environment namespacing (dev/staging/prod) — planned for v2
- Cross-project access controls — planned for v2
- Third-party password manager backends (1Password, Bitwarden) — planned for v2
- MCP server protocol — planned for v2

---

## Supported Runtimes

| Runtime | Tier 1 | Tier 2 | Tier 3 |
|---------|--------|--------|--------|
| [GitHub Copilot CLI](https://githubnext.com/projects/copilot-cli) | ✅ | ✅ | ✅ |
| [OpenCode](https://opencode.ai) | ✅ | ✅ | ✅ |
| [Claude Code](https://claude.ai/code) | ✅ | ✅ | ✅ |

---

## Architecture

```
see-crets/
├── SKILL.md                     # Tier 1: shared behavioral skill (all runtimes)
├── plugin.json                  # Copilot CLI plugin manifest
├── .claude-plugin/plugin.json   # Claude Code plugin manifest
├── src/
│   ├── cli.ts                   # CLI entry point
│   ├── runtimes/
│   │   └── opencode.ts          # OpenCode native plugin
│   ├── vault/
│   │   ├── detect.ts            # OS detection → select backend
│   │   ├── macos.ts             # Keychain
│   │   ├── windows.ts           # Credential Manager
│   │   └── linux.ts             # libsecret + pass fallback
│   ├── tools/                   # Shared logic (CLI + plugins)
│   │   ├── ask-secret-set.ts
│   │   ├── secrets-list.ts
│   │   ├── secrets-detect.ts
│   │   └── secrets-rotate.ts
│   └── hook/
│       ├── inject.ts            # Placeholder resolution + env injection
│       └── scrub.ts             # Output redaction
└── hooks/
    ├── hooks.json               # Hook config (Claude Code + Copilot CLI)
    ├── pre-secrets.sh           # Bash hook (macOS/Linux)
    └── pre-secrets.ps1          # PowerShell hook (Windows)
```

---

## Development

### Prerequisites

- [Bun](https://bun.sh) >= 1.0

### Setup

```bash
git clone https://github.com/yldgio/see-crets
cd see-crets
bun install
```

### Build

```bash
bun run build
```

### Test

```bash
bun test
```

### Lint

```bash
bun run lint
```

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on pull requests, commit messages, and the development workflow.

---

## Security

To report a security vulnerability, please read [SECURITY.md](SECURITY.md). **Do not open a public issue for security bugs.**

---

## Roadmap

- [x] Design and architecture
- [ ] Phase 1: Walking skeleton (Windows CLI — `set` + `list`)
- [ ] Phase 2: Cross-platform vault backends (macOS + Linux)
- [ ] Phase 3: Injection and output scrubbing (security core)
- [ ] Phase 4: Env var mapping (built-in + per-project)
- [ ] Phase 5: Secret management and namespacing
- [ ] Phase 6: OpenCode native plugin (Tier 2)
- [ ] Phase 7: Tier 3 hooks and plugin manifests
- [ ] Phase 8: Documentation and distribution
- [ ] v2: Environment namespacing (dev/staging/prod)
- [ ] v2: Cross-project access controls
- [ ] v2: Third-party vault backends (1Password, Bitwarden)
- [ ] v2: MCP server protocol

---

## License

[MIT](LICENSE) © 2025 yldgio
