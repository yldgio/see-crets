import { describe, it, expect } from "bun:test";
import type { VaultBackend } from "../vault/types.ts";
import { injectCommand } from "./inject-command.ts";
import { scrubOutput } from "./scrub-output-command.ts";

// ---------------------------------------------------------------------------
// Shared mock factory — in-memory backend, no OS calls
// ---------------------------------------------------------------------------

function createMockBackend(store: Map<string, string>): VaultBackend {
  return {
    name: "MockVault",
    async isAvailable() {
      return true;
    },
    async set() {},
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async delete() {},
    async list(prefix: string) {
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

// ---------------------------------------------------------------------------
// injectCommand() tests
// ---------------------------------------------------------------------------

describe("injectCommand", () => {
  it("resolves {{SECRET:key}} placeholder and returns env map", async () => {
    const store = new Map([["my-project/api-token", "tok_supersecret"]]);
    const backend = createMockBackend(store);

    const result = await injectCommand(
      'curl -H "Authorization: Bearer {{SECRET:my-project/api-token}}" https://api.example.com',
      backend,
    );

    expect(result.command).not.toContain("{{SECRET:");
    expect(result.command).not.toContain("tok_supersecret");
    expect(result.keys).toContain("my-project/api-token");
    expect(Object.values(result.env)).toContain("tok_supersecret");
  });

  it("returns original command unchanged when vault is empty", async () => {
    const backend = createMockBackend(new Map());
    const cmd = "git status";

    const result = await injectCommand(cmd, backend);

    expect(result.command).toBe(cmd);
    expect(result.keys).toHaveLength(0);
    expect(Object.keys(result.env)).toHaveLength(0);
  });

  it("auto-injects vault keys matching the built-in env-var map", async () => {
    const store = new Map([["test-project/github-token", "ghp_autoinjected"]]);
    const backend = createMockBackend(store);

    const result = await injectCommand("gh repo list", backend);

    // Command unchanged (no placeholder) but env carries the token
    expect(result.command).toBe("gh repo list");
    expect(result.env["GITHUB_TOKEN"]).toBe("ghp_autoinjected");
    expect(result.keys).toContain("test-project/github-token");
  });

  it("throws SecretNotFoundError for an unknown placeholder key", async () => {
    const backend = createMockBackend(new Map());

    const { SecretNotFoundError } = await import("../hook/inject.ts");
    await expect(
      injectCommand("echo {{SECRET:unknown/key}}", backend),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
  });

  it("does not include secret values in the returned command string", async () => {
    const store = new Map([["vault/secret", "SuperSecret_Value_12345"]]);
    const backend = createMockBackend(store);

    const result = await injectCommand("echo {{SECRET:vault/secret}}", backend);

    expect(result.command).not.toContain("SuperSecret_Value_12345");
  });

  it("handles multiple distinct placeholders in one command", async () => {
    const store = new Map([
      ["proj/token-a", "val_aaaa"],
      ["proj/token-b", "val_bbbb"],
    ]);
    const backend = createMockBackend(store);

    const result = await injectCommand(
      "cmd --a={{SECRET:proj/token-a}} --b={{SECRET:proj/token-b}}",
      backend,
    );

    expect(result.command).not.toContain("{{SECRET:");
    expect(result.command).not.toContain("val_aaaa");
    expect(result.command).not.toContain("val_bbbb");
    expect(result.keys).toContain("proj/token-a");
    expect(result.keys).toContain("proj/token-b");
    expect(Object.values(result.env)).toContain("val_aaaa");
    expect(Object.values(result.env)).toContain("val_bbbb");
  });
});

// ---------------------------------------------------------------------------
// scrubOutput() tests
// ---------------------------------------------------------------------------

describe("scrubOutput", () => {
  it("replaces vault secret values with [REDACTED]", async () => {
    // Use global/ prefix so these keys are in scope regardless of which
    // git project scrubOutput detects from the real working directory.
    const store = new Map([
      ["global/api-key", "sk_live_supersecret"],
      ["global/npm-token", "npm_topsecret"],
    ]);
    const backend = createMockBackend(store);

    const raw =
      "Response: sk_live_supersecret and also npm_topsecret found here";
    const result = await scrubOutput(raw, backend);

    expect(result).not.toContain("sk_live_supersecret");
    expect(result).not.toContain("npm_topsecret");
    expect(result).toContain("[REDACTED]");
  });

  it("returns input unchanged when vault is empty", async () => {
    const backend = createMockBackend(new Map());
    const raw = "No secrets here, just regular output";

    const result = await scrubOutput(raw, backend);

    expect(result).toBe(raw);
  });

  it("throws on vault error — callers decide the fallback policy (fail-closed by default)", async () => {
    // scrubOutput() no longer swallows vault errors. The old behaviour (returning
    // raw input on failure) was a fail-open vulnerability: live secrets could reach
    // the LLM. Callers are now responsible for catching and choosing a policy.
    const brokenBackend: VaultBackend = {
      name: "BrokenVault",
      async isAvailable() {
        return false;
      },
      async set() {},
      async get() {
        throw new Error("vault unavailable");
      },
      async delete() {},
      async list() {
        throw new Error("vault unavailable");
      },
    };

    const raw = "Some tool output with data";
    await expect(scrubOutput(raw, brokenBackend)).rejects.toThrow(
      "vault unavailable",
    );
  });

  it("does not scrub values shorter than MIN_SECRET_LENGTH (8 chars)", async () => {
    const store = new Map([["global/short", "abc"]]);
    const backend = createMockBackend(store);

    const raw = "output contains abc somewhere";
    const result = await scrubOutput(raw, backend);

    // 'abc' is below MIN_SECRET_LENGTH — must not be replaced
    expect(result).toContain("abc");
  });
});
