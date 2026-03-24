import { basename } from "path"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { askSecretSet } from "../tools/ask-secret-set.ts"
import { secretsList } from "../tools/secrets-list.ts"
import { secretsDetect } from "../tools/secrets-detect.ts"
import { injectSecrets } from "../hook/inject.ts"
import { resolveEnvMap, envVarForKey } from "../hook/env-map.ts"
import { detectBackend } from "../vault/detect.ts"

const SHELL_TOOLS = new Set(["bash", "powershell", "run_terminal_cmd", "shell"])
const PLACEHOLDER_RE = /\{\{SECRET:([^}]+)\}\}/

/**
 * Per-call store for env vars resolved from {{SECRET:key}} placeholders in
 * tool.execute.before. The shell.env hook consumes and clears these by callID.
 */
const pendingEnv = new Map<string, Record<string, string>>()

/**
 * OpenCode native plugin for see-crets.
 *
 * Registers three LLM-callable tools:
 *   - ask_secret_set  — masked human-in-the-loop secret storage
 *   - secrets_list    — list key names (never values)
 *   - secrets_detect  — report vault backend health
 *
 * Hooks:
 *   - tool.execute.before — resolves {{SECRET:key}} placeholders in shell commands
 *   - shell.env           — auto-injects mapped vault keys as env vars into every subprocess
 *
 * delete, purge, and rotate are intentionally NOT registered as tools.
 */
export const SecretsPlugin: Plugin = async ({ worktree }) => {
  return {
    tool: {
      ask_secret_set: tool({
        description:
          "Ask the human to securely store a named secret in the OS-native vault. " +
          "The value is collected via a masked terminal prompt — it NEVER appears in " +
          "tool arguments or the return value. In non-interactive environments, " +
          "returns instructions for the human to run `see-crets set <key>` in a " +
          "separate terminal.",
        args: {
          key: tool.schema
            .string()
            .describe(
              "Secret key name (e.g. 'github-token'). Auto-namespaced to the " +
              "current project unless the name already contains a namespace prefix.",
            ),
          project: tool.schema
            .string()
            .optional()
            .describe(
              "Optional project namespace override. Defaults to the git-root " +
              "basename or 'global'.",
            ),
        },
        execute: async ({ key, project }) => {
          const result = await askSecretSet(key, project)
          // Security invariant: result is {stored, key, namespace} — no 'value' field
          return JSON.stringify(result)
        },
      }),

      secrets_list: tool({
        description:
          "List all secret key names available for the current project and global " +
          "namespace. Returns KEY NAMES ONLY — never secret values. " +
          "Equivalent to running `see-crets list` from the CLI.",
        args: {
          project: tool.schema
            .string()
            .optional()
            .describe(
              "Optional project namespace override. Defaults to the git-root " +
              "basename or 'global'.",
            ),
        },
        execute: async ({ project }) => {
          const result = await secretsList(project)
          return JSON.stringify(result)
        },
      }),

      secrets_detect: tool({
        description:
          "Report the active OS vault backend and its health status. " +
          "Use this to verify the vault is available before attempting to set or " +
          "list secrets.",
        args: {},
        execute: async () => {
          const result = await secretsDetect()
          return JSON.stringify(result)
        },
      }),
    },

    /**
     * Resolves {{SECRET:key}} placeholders in shell command arguments before execution.
     * Replaced with subprocess-scoped env var references (_SC_N); actual values are
     * stashed in pendingEnv and merged in by the shell.env hook.
     */
    "tool.execute.before": async (input, output) => {
      if (!SHELL_TOOLS.has(String(input.tool ?? ""))) return

      const args = output.args as Record<string, unknown>
      for (const argKey of ["command", "bash", "powershell", "input", "text"]) {
        const v = args[argKey]
        if (typeof v !== "string" || !PLACEHOLDER_RE.test(v)) continue

        const backend = await detectBackend()
        const result = await injectSecrets(v, backend, { autoInject: false })
        args[argKey] = result.command

        // Stash the resolved env vars keyed by callID for shell.env to pick up
        if (Object.keys(result.env).length > 0) {
          pendingEnv.set(input.callID, result.env)
        }
        break
      }
    },

    /**
     * Injects vault secrets as env vars into every subprocess spawned by OpenCode.
     *
     * Scoped to the current project namespace + global/ only — prevents accidental
     * cross-project secret exposure that would occur with a full backend.list("").
     *
     * Uses the plugin worktree (git root) as projectDir for .see-crets.json lookups
     * so overrides are found regardless of the subprocess working directory.
     *
     * Also merges in any placeholder-resolved vars from tool.execute.before.
     */
    "shell.env": async (input, output) => {
      try {
        const backend = await detectBackend()

        // Derive project name from worktree (which IS the git root)
        const projectName = worktree ? basename(worktree) : ""
        const prefixes: string[] = projectName
          ? [`${projectName}/`, "global/"]
          : ["global/"]

        // Use worktree as projectDir so .see-crets.json is always found at the git root,
        // not wherever the subprocess happens to be running (input.cwd).
        const envMap = resolveEnvMap(worktree || input.cwd)

        // List only the scoped prefixes — prevents cross-project exposure
        const keysets = await Promise.all(prefixes.map((p) => backend.list(p)))
        const allKeys = [...new Set(keysets.flat())]

        // Project-namespaced keys take precedence over global/; alphabetical within each
        const sortedKeys = [...allKeys].sort((a, b) => {
          const aGlobal = a.startsWith("global/")
          const bGlobal = b.startsWith("global/")
          if (aGlobal !== bGlobal) return aGlobal ? 1 : -1
          return a.localeCompare(b)
        })

        const seenVars = new Set<string>()
        for (const qualifiedKey of sortedKeys) {
          const targetVar = envVarForKey(qualifiedKey, envMap)
          if (!targetVar) continue
          if (seenVars.has(targetVar)) continue
          const value = await backend.get(qualifiedKey)
          if (value === null) continue
          output.env[targetVar] = value
          seenVars.add(targetVar)
        }
      } catch {
        // Vault unavailable — fail open, don't block the subprocess
      }

      // Merge any placeholder-resolved env vars stashed by tool.execute.before
      const { callID } = input
      if (callID && pendingEnv.has(callID)) {
        Object.assign(output.env, pendingEnv.get(callID))
        pendingEnv.delete(callID)
      }
    },
  }
}
