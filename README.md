# see-crets

> **OS-native secret vault for AI agents. LLMs see key names. Never values.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?logo=bun)](https://bun.sh)
[![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)]()
[![Status](https://img.shields.io/badge/status-v0.1-green)]()

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

## Features

- 🔐 **OS-native storage** — Keychain (macOS), Credential Manager (Windows), libsecret/pass (Linux). No files written to disk.
- 🕵️ **Output scrubbing** — If a secret leaks into stdout/stderr, it is replaced with `[REDACTED]` before the LLM sees it.
- 💉 **Two injection strategies** — Placeholder substitution (`{{SECRET:key}}`) and subprocess-scoped env injection (`VAR=value cmd`).
- 🧰 **Three runtimes** — OpenCode, GitHub Copilot CLI, Claude Code.
- 📈 **Graduated enforcement** — Start with a single Markdown file (Tier 1). Add a plugin (Tier 2). Add hooks for full enforcement (Tier 3).
- 🔑 **Auto-namespacing** — Secrets are automatically scoped to your project via `git rev-parse --show-toplevel`.
- ⚙️ **Built-in env map** — 20+ common service keys (`github-token → GITHUB_TOKEN`, `openai-api-key → OPENAI_API_KEY`, etc.) with per-project overrides.

---

## Enforcement Tiers

| Tier | What You Install | Security Model | Best For |
|------|-----------------|---------------|----------|
| **Tier 1 — Skill** | Drop `SKILL.md` in your agent config | Behavioral (agent follows guidance voluntarily) | Quick personal setup |
| **Tier 2 — Plugin** | Skill + runtime plugin | Structural (vault access only via plugin; direct vault CLIs blocked) | Team projects |
| **Tier 3 — Full** | Skill + plugin + shell hooks | Enforced (hooks block direct vault CLIs; output scrubbing active) | Production / CI |

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) >= 1.0

### Build from source

```bash
git clone https://github.com/yldgio/see-crets
cd see-crets
bun install
bun run build         # produces dist/see-crets (or dist/see-crets.exe on Windows)
```

Add `dist/` to your `PATH`, or run `./dist/see-crets` directly. The compiled binary includes the Bun runtime — no Bun or Node.js installation is required on the target machine.

### Tier 1 — Skill only (2 minutes)

The skill file tells your AI agent how to use `see-crets` and enforces the no-secret-values rule behaviourally.

**GitHub Copilot CLI** — drop the skill file into your project's agents config:
```bash
mkdir -p .agents/skills/see-crets
cp SKILL.md .agents/skills/see-crets/SKILL.md
```

**Claude Code** — reference it from your project's `CLAUDE.md` or system prompt:
```bash
cat SKILL.md >> CLAUDE.md
```

**OpenCode** — add to your project's `.opencode/rules/` directory:
```bash
mkdir -p .opencode/rules
cp SKILL.md .opencode/rules/see-crets.md
```

Then store your first secret:
```bash
see-crets set github-token
# Prompts: Enter value for 'my-project/github-token': ****
```

Your agent can now call `see-crets list` to discover available keys and use `{{SECRET:github-token}}` placeholders in commands.

### Tier 2 — Plugin (adds structural enforcement)

> Tier 2 builds on Tier 1 — complete Tier 1 setup first.

**OpenCode** — the plugin ships in `.opencode/plugins/see-crets/`. OpenCode auto-discovers plugins in `.opencode/plugins/*/index.ts`. Copy into your project:
```bash
mkdir -p /path/to/your-project/.opencode/plugins
cp -r .opencode/plugins/see-crets/ /path/to/your-project/.opencode/plugins/see-crets/
```

**GitHub Copilot CLI** — `plugin.json` references `SKILL.md`, `.github/hooks/` (tool-guard), and `hooks/` (pre-secrets). All must be present relative to the project root. Copy all required files:
```bash
PROJECT=/path/to/your-project
cp plugin.json "$PROJECT/"
cp SKILL.md "$PROJECT/"
cp -r .github/hooks/ "$PROJECT/.github/hooks/"
cp -r hooks/ "$PROJECT/hooks/"
chmod +x "$PROJECT/hooks/pre-secrets.sh" \
         "$PROJECT/.github/hooks/scripts/pre-tool-guard.sh"   # macOS / Linux
```

**Claude Code** — `plugin.json` and `.claude/settings.json` at the repo root wire up the hooks. Copy both into your project:
```bash
cp plugin.json /path/to/your-project/plugin.json
cp -r .claude/ /path/to/your-project/.claude/
```

### Tier 3 — Hooks (full enforcement + output scrubbing)

> Tier 3 builds on Tier 2 — complete Tier 2 setup first.

**OpenCode** — no extra hooks needed. The `SecretsPlugin` (installed in Tier 2) already handles placeholder resolution and env injection natively inside OpenCode's process. No shell hooks are used.

**GitHub Copilot CLI** — hooks are already installed as part of Tier 2 (Copilot CLI's `plugin.json` bundles skill and hooks together). No additional files to copy.

**Claude Code** — copy the hooks directory into your project:
```bash
cp -r hooks/ /path/to/your-project/hooks/
chmod +x hooks/pre-secrets.sh   # macOS / Linux
# hooks/pre-secrets.ps1 is used automatically on Windows
```
The hooks are already wired in `.claude/settings.json` — no further wiring needed.

---

## CLI Reference

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
# {
#   "available": true,
#   "backend": "macos",
#   "detail": "macOS Keychain (healthy)"
# }
```

### `see-crets delete <key>`

Remove a secret from the vault. Human-initiated only — not callable by agents.

```bash
see-crets delete github-token
# {
#   "deleted": true,
#   "key": "my-project/github-token",
#   "namespace": "my-project"
# }
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

## Injection Strategies

Two complementary methods ensure secret values never reach the LLM.

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
| `stripe-secret-key` | `STRIPE_SECRET_KEY` |
| `sendgrid-api-key` | `SENDGRID_API_KEY` |
| `twilio-auth-token` | `TWILIO_AUTH_TOKEN` |
| `firebase-service-account` | `FIREBASE_SERVICE_ACCOUNT` |
| `google-application-credentials` | `GOOGLE_APPLICATION_CREDENTIALS` |
| `gcp-service-account` | `GOOGLE_APPLICATION_CREDENTIALS` |
| `azure-client-secret` | `AZURE_CLIENT_SECRET` |
| `azure-tenant-id` | `AZURE_TENANT_ID` |
| `azure-client-id` | `AZURE_CLIENT_ID` |
| `heroku-api-key` | `HEROKU_API_KEY` |

### Per-Project Override

Create `.see-crets.json` in your project root (safe to commit — no secrets inside):

```json
{
  "_comment": "see-crets env-var mapping config. Safe to commit — contains mappings only, never secret values.",
  "_docs": "https://github.com/yldgio/see-crets#env-var-mapping",

  "map": {
    "my-custom-token": "MY_TOKEN",
    "db-password": "PGPASSWORD",

    "github-token": "GH_TOKEN"
  }
}
```

Keys in `map` are vault key-name suffixes (the part after the last `/`). Values are the env var to inject. You can also **override built-in mappings** — for example, setting `"github-token": "GH_TOKEN"` makes see-crets inject `GH_TOKEN` instead of the default `GITHUB_TOKEN`. Copy `.see-crets.json.example` from this repo as a starting point.

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
- Config-file injection (injecting secrets into `.env` files or config files) — planned for v2
- Cross-project access controls — planned for v2
- Compound credential assembly (building multi-part credentials from vault keys) — planned for v2
- Third-party password manager backends (1Password, Bitwarden) — planned for v2
- MCP server protocol — planned for v2
- GUI / desktop application — out of scope
- Secret sharing between users or machines — out of scope

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
├── plugin.json                  # Copilot CLI + Claude Code plugin manifest
├── src/
│   ├── cli.ts                   # CLI entry point
│   ├── runtimes/
│   │   └── opencode.ts          # OpenCode native plugin (SecretsPlugin)
│   ├── vault/
│   │   ├── detect.ts            # OS detection → select backend
│   │   ├── macos.ts             # Keychain
│   │   ├── windows.ts           # Credential Manager
│   │   └── linux.ts             # libsecret + pass fallback
│   ├── tools/                   # Shared logic (CLI + plugins)
│   │   ├── ask-secret-set.ts
│   │   ├── secrets-list.ts
│   │   └── secrets-detect.ts
│   └── hook/
│       ├── inject.ts            # Placeholder resolution + env injection
│       ├── scrub.ts             # Output redaction
│       └── env-map.ts           # Built-in + per-project env var mappings
├── .opencode/
│   └── plugins/
│       └── see-crets/
│           └── index.ts         # OpenCode plugin entry point (re-exports SecretsPlugin)
├── .github/
│   └── hooks/
│       ├── pre-tool-guard.sh    # Tool-guard hook (bash)
│       └── pre-tool-guard.ps1   # Tool-guard hook (PowerShell)
├── .github/
│   └── hooks/
│       ├── tool-guard.json      # Copilot CLI tool-guard config
│       └── scripts/
│           ├── pre-tool-guard.sh    # Tool-guard hook (bash)
│           └── pre-tool-guard.ps1   # Tool-guard hook (PowerShell)
└── hooks/
    ├── hooks.json               # Hook manifest (documentation descriptor)
    ├── pre-secrets.sh           # Pre-secrets hook (bash, macOS/Linux)
    ├── pre-secrets.ps1          # Pre-secrets hook (PowerShell, Windows)
    └── tool-guard/
        └── policy.json          # Shared tool-guard policy (all runtimes)
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
- [x] Phase 1: Walking skeleton (Windows CLI — `set` + `list`)
- [x] Phase 2: Cross-platform vault backends (macOS + Linux)
- [x] Phase 3: Injection and output scrubbing (security core)
- [x] Phase 4: Env var mapping (built-in + per-project)
- [x] Phase 5: Secret management and namespacing
- [x] Phase 6: OpenCode native plugin (Tier 2)
- [x] Phase 7: Tier 3 hooks and plugin manifests
- [x] Phase 8: Documentation and distribution
- [ ] v2: Environment namespacing (dev/staging/prod)
- [ ] v2: Cross-project access controls
- [ ] v2: Third-party vault backends (1Password, Bitwarden)
- [ ] v2: MCP server protocol

---

## License

[MIT](LICENSE) © 2025 yldgio
