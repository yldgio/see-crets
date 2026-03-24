import { describe, it, expect, mock } from "bun:test"
import type { VaultBackend } from "../vault/types.ts"
import type { PluginInput } from "@opencode-ai/plugin"

// ---------------------------------------------------------------------------
// Shared mock factory — in-memory backend, no OS calls
// ---------------------------------------------------------------------------

function createMockVault(store: Map<string, string> = new Map()): VaultBackend {
  return {
    name: "MockVault",
    async isAvailable() { return true },
    async set(k: string, v: string) { store.set(k, v) },
    async get(k: string) { return store.get(k) ?? null },
    async delete(k: string) { store.delete(k) },
    async list(prefix: string) {
      return [...store.keys()].filter((k) => k.startsWith(prefix))
    },
  }
}

// Minimal PluginInput — SecretsPlugin uses worktree for basename (project name) and
// .see-crets.json lookup. Use an absolute-style path so basename() returns the project name.
function makeMockInput(worktree = "/fake/worktree/test-project"): PluginInput {
  return {
    worktree,
    directory: worktree,
    client: undefined as never,
    project: undefined as never,
    serverUrl: new URL("http://localhost:3000"),
    $: undefined as never,
  }
}

// ---------------------------------------------------------------------------
// Tool registrations
// ---------------------------------------------------------------------------

describe("SecretsPlugin — tool registrations", () => {
  it("registers ask_secret_set, secrets_list, and secrets_detect tools", async () => {
    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVault(),
      detectResult: async () => ({ available: true, backend: "MockVault" }),
    }))
    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => false,
      getProjectName: () => "global",
    }))

    const { SecretsPlugin } = await import("./opencode.ts")
    const hooks = await SecretsPlugin(makeMockInput())

    expect(hooks.tool).toBeDefined()
    expect(hooks.tool!["ask_secret_set"]).toBeDefined()
    expect(hooks.tool!["secrets_list"]).toBeDefined()
    expect(hooks.tool!["secrets_detect"]).toBeDefined()
  })

  it("does NOT register delete, purge, or rotate tools", async () => {
    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVault(),
      detectResult: async () => ({ available: true, backend: "MockVault" }),
    }))

    const { SecretsPlugin } = await import("./opencode.ts")
    const hooks = await SecretsPlugin(makeMockInput())

    const toolNames = Object.keys(hooks.tool ?? {})
    expect(toolNames).not.toContain("delete")
    expect(toolNames).not.toContain("purge")
    expect(toolNames).not.toContain("rotate")
    expect(toolNames).not.toContain("secrets_delete")
    expect(toolNames).not.toContain("secrets_purge")
    expect(toolNames).not.toContain("secrets_rotate")
  })

  it("registers exactly 3 tools", async () => {
    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVault(),
      detectResult: async () => ({ available: true, backend: "MockVault" }),
    }))

    const { SecretsPlugin } = await import("./opencode.ts")
    const hooks = await SecretsPlugin(makeMockInput())

    expect(Object.keys(hooks.tool ?? {})).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// ask_secret_set — security invariant
// ---------------------------------------------------------------------------

describe("SecretsPlugin — ask_secret_set security invariant", () => {
  it("response contains no 'value' field in non-interactive mode", async () => {
    const originalIsTTY = process.stdin.isTTY;
    (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = false

    mock.module("../vault/detect.ts", () => ({
      detectBackend: () => Promise.reject(new Error("vault unavailable")),
      detectResult: async () => ({ available: false, backend: "none" }),
    }))
    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => false,
      getProjectName: () => "global",
    }))

    try {
      const { SecretsPlugin } = await import("./opencode.ts")
      const hooks = await SecretsPlugin(makeMockInput())

      const raw = await hooks.tool!["ask_secret_set"].execute(
        { key: "github-token", project: "test-project" } as never,
        undefined as never,
      )

      const parsed = JSON.parse(raw)
      expect(parsed).not.toHaveProperty("value")
      expect(parsed.key).toBe("test-project/github-token")
      expect(parsed.stored).toBe(false)
    } finally {
      (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = originalIsTTY
    }
  })

  it("response JSON never contains the secret value when key already exists", async () => {
    const originalIsTTY = process.stdin.isTTY;
    (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = false

    const store = new Map([["inv-project/existing-key", "SUPER_SECRET_VALUE"]])
    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVault(store),
      detectResult: async () => ({ available: true, backend: "MockVault" }),
    }))
    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => false,
      getProjectName: () => "global",
    }))

    try {
      const { SecretsPlugin } = await import("./opencode.ts")
      const hooks = await SecretsPlugin(makeMockInput())

      const raw = await hooks.tool!["ask_secret_set"].execute(
        { key: "existing-key", project: "inv-project" } as never,
        undefined as never,
      )

      expect(raw).not.toContain("SUPER_SECRET_VALUE")
      const parsed = JSON.parse(raw)
      expect(parsed).not.toHaveProperty("value")
      expect(parsed.stored).toBe(true)
    } finally {
      (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = originalIsTTY
    }
  })
})

// ---------------------------------------------------------------------------
// secrets_list — key names only
// ---------------------------------------------------------------------------

describe("SecretsPlugin — secrets_list", () => {
  it("returns key names only, never secret values", async () => {
    const store = new Map([
      ["list-project/github-token", "SUPER_SECRET_VALUE"],
      ["global/shared-key", "ANOTHER_SECRET"],
    ])
    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVault(store),
      detectResult: async () => ({ available: true, backend: "MockVault" }),
    }))
    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => true,
      getProjectName: () => "list-project",
    }))

    const { SecretsPlugin } = await import("./opencode.ts")
    const hooks = await SecretsPlugin(makeMockInput())

    const raw = await hooks.tool!["secrets_list"].execute(
      {} as never,
      undefined as never,
    )

    const parsed = JSON.parse(raw)
    expect(parsed.keys).toContain("list-project/github-token")
    expect(parsed.keys).toContain("global/shared-key")
    expect(raw).not.toContain("SUPER_SECRET_VALUE")
    expect(raw).not.toContain("ANOTHER_SECRET")
  })

  it("returns same result as secrets_list() CLI function", async () => {
    const store = new Map([
      ["cli-project/npm-token", "npm-secret"],
      ["global/openai-api-key", "openai-secret"],
    ])
    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVault(store),
      detectResult: async () => ({ available: true, backend: "MockVault" }),
    }))
    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => true,
      getProjectName: () => "cli-project",
    }))

    const { SecretsPlugin } = await import("./opencode.ts")
    const { secretsList } = await import("../tools/secrets-list.ts")

    const hooks = await SecretsPlugin(makeMockInput())
    const pluginRaw = await hooks.tool!["secrets_list"].execute(
      {} as never,
      undefined as never,
    )
    const cliResult = await secretsList()

    const pluginResult = JSON.parse(pluginRaw)
    expect(pluginResult.keys).toEqual(cliResult.keys)
    expect(pluginResult.namespace).toBe(cliResult.namespace)
  })
})

// ---------------------------------------------------------------------------
// shell.env hook — auto-injection
// ---------------------------------------------------------------------------

describe("SecretsPlugin — shell.env hook", () => {
  it("injects auto-mapped env vars from vault into subprocess env", async () => {
    const store = new Map([
      ["env-project/github-token", "ghp_test_token"],
      ["env-project/openai-api-key", "sk-test-key"],
    ])
    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVault(store),
      detectResult: async () => ({ available: true, backend: "MockVault" }),
    }))

    const { SecretsPlugin } = await import("./opencode.ts")
    const hooks = await SecretsPlugin(makeMockInput("/fake/worktree/env-project"))

    const output: { env: Record<string, string> } = { env: {} }
    await hooks["shell.env"]!({ cwd: "/fake/worktree/env-project" }, output)

    expect(output.env["GITHUB_TOKEN"]).toBe("ghp_test_token")
    expect(output.env["OPENAI_API_KEY"]).toBe("sk-test-key")
  })

  it("does not inject keys from other project namespaces (cross-project isolation)", async () => {
    const store = new Map([
      ["env-project/github-token", "ghp_current"],
      ["other-project/github-token", "ghp_other"],
      ["global/openai-api-key", "sk-global"],
    ])
    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVault(store),
      detectResult: async () => ({ available: true, backend: "MockVault" }),
    }))

    const { SecretsPlugin } = await import("./opencode.ts")
    const hooks = await SecretsPlugin(makeMockInput("/fake/worktree/env-project"))

    const output: { env: Record<string, string> } = { env: {} }
    await hooks["shell.env"]!({ cwd: "/fake/worktree/env-project" }, output)

    expect(output.env["GITHUB_TOKEN"]).toBe("ghp_current")
    expect(output.env["OPENAI_API_KEY"]).toBe("sk-global")
    expect(Object.values(output.env)).not.toContain("ghp_other")
  })

  it("fails open when vault is unavailable — does not throw", async () => {
    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => { throw new Error("vault unavailable in test") },
      detectResult: async () => ({ available: false, backend: "none" }),
    }))

    const { SecretsPlugin } = await import("./opencode.ts")
    const hooks = await SecretsPlugin(makeMockInput())

    const output: { env: Record<string, string> } = { env: {} }
    await expect(hooks["shell.env"]!({ cwd: "." }, output)).resolves.toBeUndefined()
    expect(output.env).toEqual({})
  })

  it("does not inject secret values into output.env keys — only mapped env var names", async () => {
    const store = new Map([
      ["detect-project/anthropic-api-key", "sk-ant-secret"],
    ])
    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVault(store),
      detectResult: async () => ({ available: true, backend: "MockVault" }),
    }))

    const { SecretsPlugin } = await import("./opencode.ts")
    const hooks = await SecretsPlugin(makeMockInput("/fake/worktree/detect-project"))

    const output: { env: Record<string, string> } = { env: {} }
    await hooks["shell.env"]!({ cwd: "/fake/worktree/detect-project" }, output)

    const envKeys = Object.keys(output.env)
    for (const k of envKeys) {
      expect(k).not.toContain("sk-ant-secret")
    }
    expect(output.env["ANTHROPIC_API_KEY"]).toBe("sk-ant-secret")
  })
})

// ---------------------------------------------------------------------------
// tool.execute.before — placeholder resolution + pendingEnv handoff
// ---------------------------------------------------------------------------

describe("SecretsPlugin — tool.execute.before hook", () => {
  it("rewrites {{SECRET:key}} placeholder in shell command arg", async () => {
    const store = new Map([["ph-project/api-token", "tok_supersecret"]])
    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVault(store),
      detectResult: async () => ({ available: true, backend: "MockVault" }),
    }))

    const { SecretsPlugin } = await import("./opencode.ts")
    const hooks = await SecretsPlugin(makeMockInput("/fake/worktree/ph-project"))

    const output = {
      args: { command: 'curl -H "Auth: {{SECRET:ph-project/api-token}}" https://api.example.com' },
    }
    await hooks["tool.execute.before"]!(
      { tool: "bash", sessionID: "s1", callID: "call-1" },
      output,
    )

    // Placeholder must be replaced with a shell var reference, not the raw value
    expect(output.args.command).not.toContain("{{SECRET:")
    expect(output.args.command).not.toContain("tok_supersecret")
    expect(output.args.command).toMatch(/\$\{_SC_\d+\}|%_SC_\d+%/)
  })

  it("stashes resolved env vars in pendingEnv so shell.env can inject them", async () => {
    const store = new Map([["ph2-project/db-url", "postgres://secret@host/db"]])
    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVault(store),
      detectResult: async () => ({ available: true, backend: "MockVault" }),
    }))

    const { SecretsPlugin } = await import("./opencode.ts")
    const hooks = await SecretsPlugin(makeMockInput("/fake/worktree/ph2-project"))

    const beforeOutput = {
      args: { command: "run-app --db {{SECRET:ph2-project/db-url}}" },
    }
    await hooks["tool.execute.before"]!(
      { tool: "bash", sessionID: "s2", callID: "call-2" },
      beforeOutput,
    )

    // shell.env should receive the stashed var under the same callID
    const envOutput: { env: Record<string, string> } = { env: {} }
    await hooks["shell.env"]!({ cwd: "/fake/worktree/ph2-project", callID: "call-2" }, envOutput)

    // The resolved value must be present in the env (under an opaque _SC_N name)
    expect(Object.values(envOutput.env)).toContain("postgres://secret@host/db")
    // pendingEnv must be cleared after shell.env consumes it
    const envOutput2: { env: Record<string, string> } = { env: {} }
    await hooks["shell.env"]!({ cwd: "/fake/worktree/ph2-project", callID: "call-2" }, envOutput2)
    expect(Object.values(envOutput2.env)).not.toContain("postgres://secret@host/db")
  })

  it("ignores non-shell tools — args are left unchanged", async () => {
    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVault(),
      detectResult: async () => ({ available: true, backend: "MockVault" }),
    }))

    const { SecretsPlugin } = await import("./opencode.ts")
    const hooks = await SecretsPlugin(makeMockInput())

    const output = { args: { command: "{{SECRET:some/key}}" } }
    await hooks["tool.execute.before"]!(
      { tool: "read_file", sessionID: "s3", callID: "call-3" },
      output,
    )

    // Non-shell tool — args must be untouched
    expect(output.args.command).toBe("{{SECRET:some/key}}")
  })
})
