# see-crets Walkthrough

> **Tutorial** — A step-by-step guide for developers who want to understand what they're doing.  
> Already convinced? Skip to the **[Quick Start](README.md#quick-start)** for copy-paste setup.

---

## TL;DR

- Your `.env` file disappears; your AI agent never sees a secret value again.
- Secrets live in your OS vault (Keychain / Credential Manager / libsecret).
- The AI sees key names like `my-app/github-token`; the hook resolves values just before execution.
- Tier 1 is behavioral (a skill file). Tier 2 adds structural enforcement (a plugin). Tier 3 adds enforced scrubbing (shell hooks).
- Migration from `.env` is a one-pass loop; no code changes required.

---

## What You'll Build

By the end of this guide you will have:

| Before | After |
|--------|-------|
| `GITHUB_TOKEN=ghp_abc123...` in a `.env` file | `my-app/github-token` in the OS vault |
| AI agent can see the raw token value | AI agent sees `my-app/github-token` — never the value |
| Token leaks into shell history, logs, LLM context | Value exists in-process for one subprocess call, then is gone |

The running example is a fictional Node.js project called **`my-app`** that calls the GitHub API.  
The vault key is `my-app/github-token`; the built-in map makes it available as `GITHUB_TOKEN` automatically.

---

## Prerequisites

- **Bun** ≥ 1.0 — [bun.sh](https://bun.sh)
- **`see-crets` binary** — built from source (see below)
- **OS vault** — auto-detected:

  | OS | Backend | Notes |
  |----|---------|-------|
  | macOS | Keychain | Built-in, no setup needed |
  | Windows | Credential Manager | Built-in, no setup needed |
  | Linux | libsecret → `pass` (fallback) | Run `see-crets detect` to confirm which is active |

- **AI runtime** — at least one of: GitHub Copilot CLI, Claude Code, OpenCode

### Build from source

```bash
git clone https://github.com/yldgio/see-crets
cd see-crets
bun install
bun run build   # → dist/see-crets (or dist/see-crets.exe on Windows)
```

Add `dist/` to your `PATH`, or run `./dist/see-crets` directly.

### Choose your tier

| Tier | Installs | Gives you |
|------|----------|-----------|
| **Tier 1 — Skill** | `SKILL.md` only | Behavioral guidance — agent follows rules voluntarily |
| **Tier 2 — Plugin** | Skill + runtime plugin | Structural enforcement — vault access only via plugin |
| **Tier 3 — Full** | Skill + plugin + hooks | Enforced — hooks block raw vault CLIs; output scrubbing active |

> This walkthrough uses a **Tier 1** setup for Steps 1–4. Step 3 (env injection) requires Tier 2. Step 4 (scrubbing) requires Tier 3.  
> See the [Quick Start](README.md#quick-start) for Tier 1 / 2 / 3 install commands.

---

## Step 1 — Store Your First Secret

Inside your `my-app` project directory (which is a git repo):

```bash
see-crets set github-token
```

Expected output:

```
Enter value for 'my-app/github-token': ****
{
  "stored": true,
  "key": "my-app/github-token",
  "namespace": "my-app"
}
```

**What happened:**
- `see-crets` detected the git root (`my-app`) and auto-namespaced the key.
- The value was written directly to the OS vault via masked input — it was never echoed, logged, or returned.
- The response only confirms the key name; the value is absent.

> 🔒 **Tier 1+** — `see-crets set` works at any tier. No plugin needed.

---

## Step 2 — Verify with Your AI Agent

Ask your agent to discover what secrets are available:

```bash
see-crets list
```

Expected output:

```json
{
  "keys": [
    "my-app/github-token"
  ],
  "namespace": "my-app"
}
```

**What the AI sees:**

```
# AI agent response
Available secrets:
- my-app/github-token

No values are shown. Use {{SECRET:my-app/github-token}} in a command
or rely on automatic GITHUB_TOKEN injection (built-in map).
```

The agent knows the key exists and can reference it by name. It has no way to retrieve the value — `see-crets list` never returns values, only key names.

> 🔒 **Tier 1+** — `see-crets list` works at any tier.

---

## Step 3 — Use a Secret in a Tool Call

There are two ways to use a stored secret in a command.

### Strategy A — Placeholder substitution

Write `{{SECRET:key}}` in the command. The hook resolves the value before execution.

```bash
# Agent generates:
curl -H "Authorization: Bearer {{SECRET:my-app/github-token}}" \
  https://api.github.com/user

# Hook resolves before execution:
curl -H "Authorization: Bearer ghp_abc123..." \
  https://api.github.com/user
```

> 🔒 **Tier 2+** — Placeholder resolution requires the runtime plugin (or hook) to be installed.

### Strategy B — Automatic env-var injection

For tools that read from the environment, no placeholder syntax is needed. The built-in map automatically injects `GITHUB_TOKEN` when `my-app/github-token` is stored:

```bash
# Agent generates:
gh repo list

# Hook executes as:
GITHUB_TOKEN=ghp_abc123... gh repo list
# Value is scoped to this subprocess only — it dies with the process.
```

> 🔒 **Tier 2+** — Auto env injection requires the runtime plugin (or hook) to be installed.

### Runtime-specific setup

All three runtimes use the same CLI commands. The difference is which integration file wires the hook:

**GitHub Copilot CLI**

```bash
PROJECT=/path/to/my-app
cp plugin.json "$PROJECT/"
cp SKILL.md "$PROJECT/"
cp -r .github/hooks/ "$PROJECT/.github/hooks/"
cp -r hooks/ "$PROJECT/hooks/"
chmod +x "$PROJECT/hooks/pre-secrets.sh" \
         "$PROJECT/.github/hooks/scripts/pre-tool-guard.sh"
```

**Claude Code**

```bash
cp -r .claude/ /path/to/my-app/.claude/
cp -r hooks/ /path/to/my-app/hooks/
chmod +x /path/to/my-app/hooks/pre-secrets.sh \
         /path/to/my-app/.claude/hooks/pre-tool-guard.sh
```

**OpenCode**

```bash
mkdir -p /path/to/my-app/.opencode/plugins
cp -r .opencode/plugins/see-crets/ \
      /path/to/my-app/.opencode/plugins/see-crets/
```

Once wired, the placeholder and env-injection strategies work identically across all three runtimes.

### A concrete fetch() example

Here is what a complete Node.js API call looks like from the agent's perspective:

```javascript
// Agent writes this code — no secret value anywhere:
const response = await fetch("https://api.github.com/repos/my-org/my-app", {
  headers: {
    Authorization: `Bearer {{SECRET:my-app/github-token}}`,
    Accept: "application/vnd.github+json",
  },
});
```

The hook substitutes the placeholder with the real value before the subprocess runs. The agent never sees `ghp_abc123...`.

---

## Step 4 — See Scrubbing in Action

> 🔒 **Tier 3** — Output scrubbing requires the pre-secrets hook. For Copilot CLI and Claude Code this hook is already copied during the Tier 2 setup, so scrubbing is active once you complete Tier 2. For OpenCode, scrubbing is built into the SecretsPlugin (also installed at Tier 2). No separate Tier 3 install step is needed for any runtime.

Ask your agent to echo the token value back (a realistic mistake):

**Without see-crets (or Tier 1/2 only):**

```
# AI agent response
The GitHub token is: ghp_abc123...
```

**With see-crets (Tier 3 active):**

```
# AI agent response
The GitHub token is: [REDACTED]
```

The scrubbing rule:

- Applied to all tool output **before** it reaches the LLM.
- Minimum length: 8 characters (short strings are not scrubbed to avoid false positives).
- Match mode: substring — a secret embedded in JSON, a URL, or a header value is still caught.
- Replacement: `[REDACTED]`.

The agent cannot work around this by asking for the value in a different format — any occurrence of the raw value anywhere in the output is replaced.

---

## Step 5 — Rotate the Secret

When a token expires or is compromised, update it without changing any code or config:

```bash
see-crets rotate github-token
```

Expected output:

```
New value for 'my-app/github-token': ****
{
  "rotated": true,
  "key": "my-app/github-token",
  "namespace": "my-app"
}
```

**What happened:**
- The vault entry was updated in place — no delete and re-add.
- The key name (`my-app/github-token`) is unchanged, so no code, config, or agent instructions need updating.
- The next tool call your agent makes will automatically use the new value.

> 🔒 **Tier 1+** — `see-crets rotate` is a CLI-only command (human-initiated). It works at any tier.

---

## Step 6 — Migrate from .env

If your project already has a `.env` file, import every entry into the vault with a one-pass loop, then delete the file.

### Import loop (Bash / macOS / Linux)

Migration is an interactive process: `see-crets set` always prompts for the value with masked input, so the loop below runs one prompt per key. Have your `.env` open in another window so you can copy each value when prompted.

```bash
# Print each key name from .env, then store it interactively
while IFS='=' read -r key _; do
  # Skip blank lines and comments
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  echo "→ Storing: $key"
  see-crets set "$key"
done < .env
```

Expected output (one block per entry — you type the value at each prompt):

```
→ Storing: GITHUB_TOKEN
Enter value for 'my-app/GITHUB_TOKEN': ****
{
  "stored": true,
  "key": "my-app/GITHUB_TOKEN",
  "namespace": "my-app"
}
→ Storing: DATABASE_URL
Enter value for 'my-app/DATABASE_URL': ****
{
  "stored": true,
  "key": "my-app/DATABASE_URL",
  "namespace": "my-app"
}
→ Storing: STRIPE_SECRET_KEY
Enter value for 'my-app/STRIPE_SECRET_KEY': ****
{
  "stored": true,
  "key": "my-app/STRIPE_SECRET_KEY",
  "namespace": "my-app"
}
```

### Delete the .env file

```bash
rm .env
```

> ⚠️ **Warning:** Simply adding `.env` to `.gitignore` is not enough — the file still exists on disk and can be read by any process. Delete it after migration.

### Verify migration

```bash
see-crets detect
```

Expected output:

```json
{
  "available": true,
  "backend": "macos",
  "detail": "macOS Keychain (healthy)"
}
```

Then confirm every expected key is in the vault:

```bash
see-crets list
```

Expected output:

```json
{
  "keys": [
    "my-app/GITHUB_TOKEN",
    "my-app/DATABASE_URL",
    "my-app/STRIPE_SECRET_KEY"
  ],
  "namespace": "my-app"
}
```

Use this as your migration checklist — one line per entry you expect to see.

---

## Step 7 — Custom Env Var Mapping (optional)

The built-in map covers 20+ common service keys (`github-token → GITHUB_TOKEN`, `openai-api-key → OPENAI_API_KEY`, etc.). For custom keys, or to override a built-in mapping, create `.see-crets.json` in your project root:

```bash
cp .see-crets.json.example .see-crets.json
```

Then edit it:

```json
{
  "_comment": "see-crets env-var mapping. Safe to commit — no secret values here.",
  "map": {
    "my-custom-token": "MY_TOKEN",
    "db-password":     "PGPASSWORD",
    "github-token":    "GH_TOKEN"
  }
}
```

Keys are vault key-name suffixes (the part after the last `/`). Project overrides take precedence over the built-in map.

> 📄 See [`.see-crets.json.example`](.see-crets.json.example) for the full annotated template.

---

## Next Steps

You have a fully protected project. Here are the natural next moves:

| Goal | Where to look |
|------|--------------|
| CLI command reference (all flags, args, output shapes) | [CLI Reference](README.md#cli-reference) |
| Choose the right enforcement tier for your team | [Enforcement Tiers](README.md#enforcement-tiers) |
| Full list of built-in env var mappings | [Built-in Env Var Map](README.md#built-in-env-var-map) |
| Threat model and scrubbing rules | [Security Model](README.md#security-model) |
| OS vault backend details (libsecret vs. pass on Linux) | [OS Vault Backends](README.md#os-vault-backends) |
| Contributing or reporting a security issue | [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) |
