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
