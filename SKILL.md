# see-crets — Secret Vault Skill

This repository uses `see-crets`, an OS-native secret vault. Secret **values** are never in your context window. You work with **key names only**.

---

## The Core Rule

**You must never ask for, store, log, or transmit a secret value.**
If you need a credential, use the tools below to work with key names.
The human enters values through masked prompts — not through you.

---

## Your Three Tools

### 1. `see-crets set <key>` — Request a new secret

Use this when you need a credential that has not been stored yet.

```bash
see-crets set github-token
# or with an explicit namespace:
see-crets set my-project/github-token
```

**What happens:**
- Interactive terminal: the human is prompted to type the value (characters hidden)
- Non-interactive / piped: you receive instructions to open a separate terminal
- Either way: **you never see the value**. The response is `{"stored": true, "key": "..."}`.

### 2. `see-crets list` — Discover stored keys

Use this to find out which secrets are already in the vault.

```bash
see-crets list
```

Returns key names for the current project and the `global/` namespace. Never returns values.

### 3. `see-crets detect` — Check vault health

Use this before attempting secret-dependent operations.

```bash
see-crets detect
```

Returns `{"available": true, "backend": "..."}` or an error with a diagnostic message.

---

## Key Naming

Keys follow the pattern `{namespace}/{name}`:

| Key | Meaning |
|-----|---------|
| `my-app/github-token` | Project-specific GitHub PAT |
| `global/npm-token` | Shared npm publish token |
| `my-app/database-url` | Project database connection string |

When you call `see-crets set github-token`, the namespace is derived automatically from the git root (or `global/` if outside a repo).

---

## Using Secrets in Commands

Reference stored secrets with the `{{SECRET:key}}` placeholder:

```bash
# The hook resolves the placeholder before execution — you never see the value
curl -H "Authorization: Bearer {{SECRET:my-app/github-token}}" https://api.github.com/user
```

Or rely on automatic env-var injection for well-known tools:

```bash
# GITHUB_TOKEN is injected automatically if `my-app/github-token` is stored
gh repo list
```

---

## What You Must NOT Do

- ❌ Ask the human to paste a secret value into the chat
- ❌ Generate commands like `export GITHUB_TOKEN=<paste-token-here>`
- ❌ Call `security find-generic-password`, `cmdkey /list`, or `secret-tool lookup` directly
- ❌ Store secrets in `.env` files, config files, or environment variables that persist beyond a single command
- ❌ Return a secret value from any tool call

---

## Quick Reference

| Task | Command |
|------|---------|
| Check what's stored | `see-crets list` |
| Store a new secret | `see-crets set <key>` |
| Check vault health | `see-crets detect` |
| Use a secret in a command | `{{SECRET:key}}` placeholder |

---

## Installing see-crets

This section is self-contained. Follow it in order to install the binary and wire see-crets into your project and AI runtime.

---

### detect_os

Identify your OS and architecture before running the installer.

**macOS**
```sh
uname -s   # → Darwin
uname -m   # → x86_64  (Intel) or arm64  (Apple Silicon)
```
Use `install.sh`. The script detects arch automatically.

**Linux**
```sh
uname -s   # → Linux
uname -m   # → x86_64 or aarch64 / arm64
```
Use `install.sh`. The script also detects musl (Alpine, Void, …) automatically.

**Windows**
```powershell
$env:OS   # → Windows_NT
```
Use `install.ps1` via PowerShell. Only x64 is supported currently.

> **Arch detection**: you never need to pass the arch manually — the installer reads `uname -m` (Unix) or `$env:PROCESSOR_ARCHITECTURE` (Windows) and selects the correct binary.

---

### run_install

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/yldgio/see-crets/main/install.sh | bash
```

> ⚠️ The script enforces bash (`set -euo pipefail`). Use `| bash`, not `| sh`.

**Windows (PowerShell)**
```powershell
PowerShell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/yldgio/see-crets/main/install.ps1 | iex"
```

**Pin a specific version**
```bash
VERSION=0.1.0 curl -fsSL https://raw.githubusercontent.com/yldgio/see-crets/main/install.sh | bash
```

Windows equivalent:
```powershell
$env:VERSION='0.1.0'; irm https://raw.githubusercontent.com/yldgio/see-crets/main/install.ps1 | iex
```

**Custom install prefix** (Unix only; default is `$HOME/.local/bin`)
```bash
PREFIX=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/yldgio/see-crets/main/install.sh | bash
```

---

### verify_install

```sh
see-crets --version   # prints e.g. 0.1.0
see-crets list        # prints empty JSON result (no secrets yet) — confirms vault access
```

If `see-crets` is not found after install:
1. **Restart your shell** (PATH is updated at install time but requires a new session to take effect).
2. **Or add the bin dir to PATH manually**: for macOS/Linux the default is `~/.local/bin`; for Windows it is `%USERPROFILE%\.see-crets\bin`. Add the directory to your shell's startup file:
   ```sh
   export PATH="$HOME/.local/bin:$PATH"
   ```

---

### wire_tier1

Set initial secrets, optionally scoping them to a project namespace. The namespace is derived from the git root by default; use `--project` to override.

```sh
# Store secrets (defaults to git-root namespace):
see-crets set OPENAI_API_KEY    # prompts for value (characters hidden)
see-crets set DATABASE_URL      # prompts for value (characters hidden)

# Store under an explicit project namespace:
see-crets set OPENAI_API_KEY --project my-project
see-crets set DATABASE_URL    --project my-project

see-crets list                  # confirm keys are stored
```

> Secret **values** are entered through a masked prompt — the AI never sees them. The `set` command returns `{"stored": true, "key": "..."}`.

---

### wire_tier2

Create `.see-crets.json` in the project root to configure additional env-var injection via the pre-secrets hook. The file uses a `map` object that overrides or extends the built-in key-suffix → env-var mapping:

```json
{
  "map": {
    "openai-api-key": "OPENAI_API_KEY",
    "database-url": "DATABASE_URL"
  }
}
```

The keys in `map` are **key-name suffixes** (the part after the last `/` in a fully-qualified key, e.g. `my-project/openai-api-key` → suffix `openai-api-key`). The values are the target environment variable names.

> Many common suffixes (e.g. `openai-api-key`, `github-token`, `database-url`) are already in the built-in map — you only need entries in `.see-crets.json` for custom or non-standard names.

With this file present, the pre-secrets hook (registered in [wire_tier3](#wire_tier3)) resolves and injects the mapped environment variables automatically before each tool call. You never reference values directly.

---

### wire_tier3

Register the pre-secrets hook in your AI runtime so secrets are injected before every tool invocation.

**Copilot CLI** — add to `~/.copilot/config.json` (or via Copilot settings):

Register `hooks/pre-secrets.sh` (Unix) or `hooks/pre-secrets.ps1` (Windows) as a pre-tool hook. Refer to the Copilot CLI hooks documentation for the exact config key.

**Claude Code** — create or update `.claude/settings.json` in the project root:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "hooks/pre-secrets.sh"
          }
        ]
      }
    ]
  }
}
```

On Windows, replace `hooks/pre-secrets.sh` with `hooks/pre-secrets.ps1`.

**OpenCode** — the plugin manifest at `.opencode/plugins/see-crets/index.ts` wires the hook automatically. No manual setup is needed as long as the plugin is installed.

---

### migrate_env

Import secrets from an existing `.env` file. Because `see-crets set` requires an interactive TTY (to show the masked prompt), import must be done **one key at a time in a real terminal**:

```sh
# Run each command in your terminal and type the value when prompted
see-crets set openai-api-key    # enter value from .env
see-crets set database-url      # enter value from .env
```

Alternatively, use `grep` to list the key names so you don't miss any:

```sh
grep -v '^\s*#' .env | grep '=' | cut -d= -f1
# then run: see-crets set <each-key-name>
```

After migrating all values, add `.env` to `.gitignore` (or delete it) — the vault is now the source of truth.

---

### upgrade

```sh
see-crets upgrade   # checks latest GitHub release and updates the binary in-place
```

The command prints one of:
- `Already on latest (vX.Y.Z)` — nothing to do.
- `Upgraded vX.Y.Z → vA.B.C` — binary replaced and checksum-verified.

To check your current version before upgrading:
```sh
see-crets --version
```

> **Windows note**: the running `.exe` is file-locked. If upgrade fails with a "cannot replace running binary" error, follow the printed instructions to manually swap the temp file into place.
