import type { Plugin } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

type Mode = "deny" | "warn"

type CommandRule = {
  pattern: string
  match?: "contains"
  mode: Mode
  reason: string
}

type CategoryPolicy = {
  preferred: string[]
  blocked: string[]
  mode: Mode
  reason: string
}

type Policy = {
  extra_banned_commands?: CommandRule[]
  categories?: Record<string, CategoryPolicy>
}

const SHELL_TOOLS = new Set(["bash", "powershell", "run_terminal_cmd", "shell"])

function extractCommand(args: Record<string, unknown> | undefined): string | null {
  for (const key of ["command", "bash", "powershell", "input", "text"]) {
    const v = args?.[key]
    if (typeof v === "string" && v.trim().length > 0) return v
  }
  return null
}

export const ToolGuard: Plugin = async ({ worktree }) => {
  let policy: Policy
  try {
    const policyPath = path.join(worktree, "hooks", "tool-guard", "policy.json")
    policy = JSON.parse(await fs.readFile(policyPath, "utf8")) as Policy
  } catch {
    // policy.json missing — fail open so OpenCode remains usable
    return {}
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (!SHELL_TOOLS.has(String(input.tool ?? ""))) return

      const command = extractCommand(output.args as Record<string, unknown>)
      if (!command) return

      const norm = command.toLowerCase().replace(/\s+/g, ' ').trim()

      for (const rule of policy.extra_banned_commands ?? []) {
        if (!norm.includes(rule.pattern.toLowerCase())) continue
        const msg = rule.mode === "warn" ? `⚠️ Advisory: ${rule.reason}` : rule.reason
        throw new Error(msg)
      }

      for (const [, category] of Object.entries(policy.categories ?? {})) {
        const match = category.blocked.find((p) => norm.includes(p.toLowerCase()))
        if (!match) continue
        const msg = category.mode === "warn" ? `⚠️ Advisory: ${category.reason}` : category.reason
        throw new Error(msg)
      }
    },
  }
}
