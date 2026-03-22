# Tool Guard Policy

Runtime-native enforcement for this Bun project.  
All rules live in `policy.json` — edit that file and enforcement takes effect immediately, no script regeneration needed.

## What is blocked

| Category | Blocked | Mode | Use instead |
|----------|---------|------|-------------|
| Package manager | `npm`, `yarn`, `pnpm` | ⚠️ Warn | `bun install` / `bun add` / `bun remove` |
| Task runner | `npx` | ⚠️ Warn | `bunx` or `bun run` |
| Test runner | `jest`, `vitest`, `mocha`, `jasmine` | 🚫 Deny | `bun test` |
| Destructive ops | `rm -rf` | 🚫 Deny | Use specific paths; `rm -r` with care |
| Force push | `git push --force`, `git push -f` | 🚫 Deny | `git push --force-with-lease` |

## Mode definitions

- **deny** — AI tool call is blocked and the agent is told why.
- **warn** — Same as deny (execution is still blocked), but the reason is prefixed with `⚠️ Advisory:` to signal the block is advisory rather than a hard policy.

## Runtimes covered

| Runtime | Hook location |
|---------|--------------|
| GitHub Copilot CLI | `.github/hooks/tool-guard.json` + `scripts/pre-tool-guard.{sh,ps1}` |
| OpenCode | `.opencode/plugins/tool-guard/index.ts` |
| Claude Code | `.claude/hooks/pre-tool-guard.{sh,ps1}` + `.claude/settings.json` |

## Updating policy

Edit `hooks/tool-guard/policy.json`. Changes take effect immediately on the next AI tool call — no restart required.

To add a new blocked command:
```json
{
  "pattern": "some-substring",
  "match": "contains",
  "mode": "deny",
  "reason": "Why this is blocked and what to use instead."
}
```

## Shell script permissions (Unix/Mac)

If running on Unix/Mac, mark the shell scripts executable:
```bash
chmod +x .github/hooks/scripts/pre-tool-guard.sh
chmod +x .claude/hooks/pre-tool-guard.sh
```
