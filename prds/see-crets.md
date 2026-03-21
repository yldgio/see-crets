# PRD: `see-crets` — OS-Native Secret Vault for AI Agents

## Problem Statement

AI coding agents (OpenCode, GitHub Copilot CLI, Claude Code) need access to secrets — API keys, PATs, database credentials — to perform real work. Today, developers are forced to choose between two bad options:

1. **Paste secrets directly into the chat** — the LLM context window sees the raw value, which can end up in logs, training data, or leaking through any of the many surfaces an AI agent touches.
2. **Block the agent entirely** — the agent fails silently or produces incomplete results because it cannot authenticate.

There is no safe, ergonomic middle path. Developers lack a way to give agents *access* to secrets without giving agents *visibility* into secret values. The result is that security-conscious teams simply cannot use AI agents for tasks that require credentials, limiting the value of these tools dramatically.

---

## Solution

`see-crets` is a self-contained tool (CLI + runtime plugins + enforcement hooks) that acts as a proxy between AI agents and the OS-native secret vault. The core contract:

- **The LLM sees key names only, never values.** (e.g. `my-app/github-token`)
- **Values are resolved in-process** at hook execution time, injected as subprocess-scoped env vars or substituted via placeholder syntax — and die with the subprocess.
- **Output is scrubbed** — if a secret value leaks into a tool's stdout/stderr, it is redacted to `[REDACTED]` before the LLM sees it.
- **OS vault is the storage backend** — macOS Keychain, Windows Credential Manager, or Linux libsecret/pass. No secret files on disk.

The tool ships as three graduated enforcement tiers so teams can adopt it progressively: a Markdown skill (behavioral guidance), a runtime plugin (structural enforcement), and shell hooks (full runtime enforcement with output scrubbing).

---

## User Stories

### Secret Storage & Retrieval

1. As a developer, I want to store a secret in the OS vault using a CLI command, so that it is protected by the OS and never written to disk in plaintext.
2. As a developer, I want the CLI to prompt me for the secret value using native masked input, so that the value never appears in my terminal history or in the AI agent's context.
3. As a developer, I want secrets to be automatically scoped to the current git project, so that I can use the same key name (`github-token`) across multiple projects without collision.
4. As a developer, I want secrets to fall back to the `global/` namespace when outside a git repository, so that the tool always works, even in ad-hoc sessions.
5. As a developer, I want to list all key names for my current project and global namespace via the CLI, so that I can see what is stored without any values being exposed.
6. As a developer, I want to delete a secret by key name, so that I can clean up stale credentials.
7. As a developer, I want to rotate a secret's value without deleting and re-adding it, so that the rotation workflow is safe and auditable.
8. As a developer, I want to run `see-crets detect` to verify which OS vault backend is active and healthy, so that I can diagnose integration issues.

### Agent Interaction (LLM-Callable Tools)

9. As an AI agent, I want to call `see-crets set <key>` to trigger a human-in-the-loop secret entry flow, so that I can request credentials without ever seeing the value.
10. As an AI agent, I want to call `see-crets list` to enumerate available key names, so that I can reference them in future commands using placeholder syntax.
11. As an AI agent, I want to call `see-crets detect` to check vault health before attempting secret-dependent operations, so that I can give the human an actionable error if the backend is unavailable.
12. As an AI agent, I want to use `{{SECRET:key}}` placeholder syntax in commands I generate, so that the human-facing hook can substitute the real value before execution without revealing it to me.
13. As an AI agent, I want to operate in the `global/` namespace with an informational message when no git root is found, so that I can still function in non-project contexts.

### Security & Enforcement

14. As a security-conscious developer, I want secret values to only exist for the duration of a single subprocess call, so that they never pollute the session environment.
15. As a security-conscious developer, I want any secret value that leaks into a tool's output to be scrubbed to `[REDACTED]` before the LLM sees it, so that accidental exposure is caught automatically.
16. As a security-conscious developer, I want the scrubbing logic to use substring matching (not exact match), so that secrets embedded in JSON blobs or URLs are still caught.
17. As a security-conscious developer, I want only values of 8+ characters to be scrubbed, so that very short strings don't produce false positive redactions.
18. As a security-conscious developer, I want direct OS vault CLI calls to be blocked by the enforcement hooks, so that an agent cannot bypass `see-crets` and read vault values directly.

### Multi-Runtime Support

19. As an OpenCode user, I want `see-crets` to be available as a native OpenCode plugin with `tool()` helpers, so that it integrates cleanly into the OpenCode tool-call UX without requiring bash wrappers.
20. As a GitHub Copilot CLI user, I want `see-crets` to be installable as a Copilot CLI plugin, so that the SKILL.md guidance and hooks are automatically activated when I install the plugin.
21. As a Claude Code user, I want `see-crets` to be installable as a Claude Code plugin, so that the same SKILL.md and hooks work in Claude Code without duplication.
22. As a developer targeting multiple runtimes, I want the skill, hooks, and shell scripts to be shared across Claude Code and Copilot CLI, so that I only maintain one set of hook logic.
23. As an OpenCode user, I want `see-crets` to inject well-known env vars (e.g. `GITHUB_TOKEN`) into tool calls automatically, so that tools that read from the environment work without explicit placeholder syntax.

### Configuration & Customization

24. As a developer, I want to define custom env var mappings per-project in a `.see-crets.json` file, so that I can map arbitrary secret key names to the env var names that my tools expect.
25. As a developer, I want `.see-crets.json` to be safe to commit to git (no secret values), so that the mapping config can be shared with teammates.
26. As a developer, I want `see-crets` to ship with ~20 built-in mappings for common tools (GitHub, Azure DevOps, database URLs), so that most projects work with zero config.

### Installation & Adoption

27. As a developer, I want to be able to adopt `see-crets` incrementally (Tier 1 → Tier 2 → Tier 3), so that I can start with low-friction behavioral guidance and add enforcement later.
28. As a team lead, I want Tier 1 (SKILL.md only) to require no installation beyond dropping a file, so that the team can adopt it immediately.
29. As a developer, I want Tier 3 enforcement to actively block any agent attempt to read from the OS vault directly, so that enforcement is robust even against a misbehaving or jailbroken agent.
30. As a developer using Linux, I want `see-crets` to auto-detect the available vault backend (libsecret first, then `pass`), so that it works across different Linux environments without manual config.
31. As a developer using Windows, I want `see-crets` to use Credential Manager with DPAPI, so that secrets are encrypted at rest using the OS user account.
32. As a developer using macOS, I want `see-crets` to use Keychain via the `security` CLI, so that secrets are managed through the standard macOS trust model.

---

## Implementation Decisions

### Architecture

- **No MCP server in v1.** Tools are exposed as `see-crets` CLI subcommands callable by the LLM via bash. OpenCode gets native `tool()` wrappers around the same CLI. This keeps the tool independently useful without runtime-specific protocol requirements.
- **CLI binary** built with Bun, output as a standalone executable (`see-crets`). Both the CLI and the OpenCode native plugin share the `src/tools/` logic layer.
- **OpenCode** uses its native plugin system (`.opencode/plugins/`), exporting a `Plugin` function and registering tools with the `tool()` helper from `@opencode-ai/plugin`. Hooks use `tool.execute.before` and `shell.env`.
- **Claude Code + Copilot CLI** use their respective plugin directory structures (`.claude-plugin/plugin.json` and `plugin.json`) but share the same `SKILL.md`, `hooks/hooks.json`, `hooks/pre-secrets.sh`, and `hooks/pre-secrets.ps1`.

### Secret Namespace

- Key format: `{project}/{key}` or `global/{key}`
- Project name = `git rev-parse --show-toplevel | xargs basename` — no config file needed
- No git root → silently use `global/` namespace; LLM is informed of this context
- No environment namespacing in v1 (dev/staging/prod deferred to v2)

### OS Vault Backends

- macOS: `security add-generic-password` / `security find-generic-password`
- Windows: `cmdkey` + DPAPI via PowerShell
- Linux: `secret-tool` (libsecret) → `pass` (GPG store) → hard error
- Auto-detected at runtime; no third-party password managers in v1

### Injection Strategies (both active)

- **Strategy A — Placeholder substitution:** `{{SECRET:key}}` in agent-generated commands; hook resolves before execution
- **Strategy B — Subprocess-scoped env injection:** well-known env vars injected for single subprocess call duration (never exported to session)

### Output Scrubbing

- Implementation: `src/hook/scrub.ts`
- Threshold: min 8 characters to trigger redaction
- Match mode: substring (a secret embedded inside a longer string is still caught)
- Replacement: `[REDACTED]`

### Env Var Mapping

- Built-in map: ~20 entries (e.g. `github-token → GITHUB_TOKEN`, `azure-devops-pat → AZURE_DEVOPS_PAT`, `database-url → DATABASE_URL`)
- Per-project override: `.see-crets.json` at git root — contains key-name → env-var-name mappings only; safe to commit

### Tool Surface

**LLM-callable (public):**
- `ask_secret_set` / `see-crets set <key>` — human-in-the-loop masked input → vault store
- `secrets_list` / `see-crets list` — key names only, never values
- `secrets_detect` / `see-crets detect` — vault backend health

**Human-only (destructive):**
- `see-crets delete <key>`, `see-crets purge`, `see-crets rotate <key>`

**Hook-internal (not in tool schema):**
- `_secrets_get`, `_secrets_inject`, `_secrets_set`

### Graduated Enforcement Tiers

| Tier | Components | Security Model |
|------|------------|---------------|
| 1 | `SKILL.md` | Behavioral — agent follows voluntarily |
| 2 | Skill + plugin | Structural — vault access only via plugin |
| 3 | Skill + plugin + hook | Enforced — hooks block direct vault CLIs; output scrubbing active |

### Masked Input

- Primary: native TTY masking per runtime
- Fallback (non-interactive contexts): CLI returns instructions for the human to run `see-crets set <key>` in a separate terminal, then confirms storage

---

## Testing Decisions

**What makes a good test for `see-crets`:**
- Tests should verify *external behavior* — what the CLI outputs, what gets stored in the vault, what env vars are injected, what gets scrubbed — not internal implementation details like which private function was called.
- Vault operations should be tested against a mock/stub backend so tests don't require a real OS vault.

**Modules to test:**

- `src/vault/detect.ts` — correct backend selected per OS; Linux fallback chain (libsecret → pass → error)
- `src/vault/{macos,windows,linux}.ts` — store, retrieve, delete, list operations (mock backend)
- `src/tools/secrets-list.ts` — returns key names only; respects project + global namespace; never returns values
- `src/tools/ask-secret-set.ts` — masked input flow triggers correctly; `_secrets_set` is called with the right arguments; LLM-facing response contains `{stored: true, key: "..."}`
- `src/hook/inject.ts` — placeholder substitution resolves `{{SECRET:key}}` correctly; subprocess env map built correctly; session env not polluted
- `src/hook/scrub.ts` — values ≥8 chars are redacted; values <8 chars are not; substring matches inside larger strings are redacted; multiple occurrences all redacted
- `src/tools/secrets-detect.ts` — returns correct backend name and health status

---

## Out of Scope

- **Environment namespacing (dev/staging/prod):** No sub-namespaces in the key path in v1. Deferred to v2.
- **Config-file injection:** Writing resolved secret values into config files (AWS `credentials`, `.npmrc`, MCP config files). Requires a new `secrets_write_config` tool. Deferred to v2.
- **Cross-project access controls:** An agent in project A being blocked from reading project B's secrets. Deferred to v2.
- **Compound credential assembly:** Building a `DATABASE_URL` from multiple stored components (host, user, password). Deferred to v2.
- **Third-party password manager backends:** 1Password CLI, Bitwarden, HashiCorp Vault. OS-native backends only in v1.
- **MCP server:** No MCP protocol implementation in v1. Tools exposed as CLI subcommands only.
- **GUI or web dashboard:** CLI-only in v1.
- **Secret sharing / team sync:** Secrets are local to the developer's machine. No sync mechanism in v1.

---

## Further Notes

- **Core security invariant:** The LLM sees key *names* only. Values exist only in-process for the duration of one subprocess call. This must be preserved by all future changes.
- **Design file:** The full architectural design (including resolved open points from the grooming session) lives in `see-crets-design.md` (excluded from git).
- **Skill chaining:** After implementation, this PRD feeds naturally into `plan-from-prd` for phased planning and `prd-slice` for creating tracker work items.
- **The `see-crets set` flow is a security boundary.** The LLM initiates it, the human completes it. Any change to this flow must preserve the invariant that the value never appears in the LLM's context — not in the tool call arguments, not in the tool response, not in any log.
