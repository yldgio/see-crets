# AGENTS.md
Project: see-crets — OS-native secret vault for AI agents; LLMs see key names only, never values.
Stack: TypeScript (bun), Bash/PowerShell hooks
Key paths: src/vault/ (backends), src/tools/ (LLM-callable), src/lifecycle.ts (human-only: delete/purge/rotate), src/utils/ (git root detection), hooks/ (Tier 3 enforcement: pre-secrets.sh/ps1 + tool-guard/policy.json), plugin.json (Copilot CLI entry point — keep in sync with .claude/settings.json), .claude/settings.json (Claude Code hook wiring — keep in sync with plugin.json)
Keep this file updated when critical changes occur.
Keep documentation updated when changes occur.
