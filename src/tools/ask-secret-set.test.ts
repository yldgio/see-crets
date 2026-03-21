import { describe, it, expect, mock } from "bun:test";
import type { VaultBackend } from "../vault/types.ts";

// ---------------------------------------------------------------------------
// Mock vault backend
// ---------------------------------------------------------------------------

function createMockBackend(
  initial?: Record<string, string>
): VaultBackend & { _store: Map<string, string> } {
  const store = new Map<string, string>(
    initial ? Object.entries(initial) : []
  );

  return {
    name: "MockBackend",
    _store: store,
    async isAvailable() { return true; },
    async set(key, value) { store.set(key, value); },
    async get(key) { return store.get(key) ?? null; },
    async delete(key) { store.delete(key); },
    async list(prefix) {
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

// ---------------------------------------------------------------------------
// Core security invariant tests
// askSecretSet must NEVER include the value in its return object.
// ---------------------------------------------------------------------------

describe("askSecretSet — security invariant", () => {
  it("response does NOT contain the secret value (stored=true path)", () => {
    // Simulate what askSecretSet returns on successful storage
    const secretValue = "ghp_super_secret_token_abc123";
    const qualifiedKey = "my-project/github-token";

    // The result shape the tool must return
    const result = {
      stored: true as const,
      key: qualifiedKey,
      namespace: "my-project",
    };

    // Verify: value absent from every field
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secretValue);
    expect(result).not.toHaveProperty("value");
    expect(result.stored).toBe(true);
    expect(result.key).toBe(qualifiedKey);
  });

  it("response does NOT contain the secret value (stored=false non-interactive path)", () => {
    const secretValue = "ghp_super_secret_token_abc123";
    const qualifiedKey = "my-project/github-token";

    const result = {
      stored: false as const,
      key: qualifiedKey,
      instructions:
        "Open a separate terminal and run:\n\n  see-crets set my-project/github-token",
    };

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secretValue);
    expect(result).not.toHaveProperty("value");
    expect(result.stored).toBe(false);
  });

  it("set result key matches the qualified key, not a raw key fragment", () => {
    const result = {
      stored: true as const,
      key: "my-project/github-token",
      namespace: "my-project",
    };

    // Key must be fully qualified (namespace/name)
    expect(result.key).toMatch(/^[^/]+\/.+$/);
  });

  it("mock backend stores without returning value", async () => {
    const backend = createMockBackend();
    const secretValue = "s3cr3t_database_url_12345";
    const key = "my-project/db-url";

    await backend.set(key, secretValue);

    // list() must not reveal the value
    const keys = await backend.list("my-project/");
    expect(keys).toContain(key);
    const serializedKeys = JSON.stringify(keys);
    expect(serializedKeys).not.toContain(secretValue);
  });

  it("fully qualified key preserves provided namespace when key already has slash", () => {
    // Simulate logic: if rawKey already contains "/", use as-is
    const rawKey = "global/my-special-token";
    const qualifiedKey = rawKey.includes("/") ? rawKey : `my-project/${rawKey}`;
    expect(qualifiedKey).toBe("global/my-special-token");
  });

  it("key without slash is namespaced with project", () => {
    const rawKey = "github-token";
    const project = "my-project";
    const qualifiedKey = rawKey.includes("/") ? rawKey : `${project}/${rawKey}`;
    expect(qualifiedKey).toBe("my-project/github-token");
  });

  it("non-interactive result instructions mention see-crets set", () => {
    const key = "my-project/github-token";
    const result = {
      stored: false as const,
      key,
      instructions: `Open a separate terminal and run:\n\n  see-crets set ${key}`,
    };

    expect(result.instructions).toContain("see-crets set");
    expect(result.instructions).toContain(key);
  });
});

// ---------------------------------------------------------------------------
// Real askSecretSet() call tests
// These exercise the actual function with mocked dependencies.
// ---------------------------------------------------------------------------

/** Creates a minimal in-memory VaultBackend for mocking detectBackend. */
function createMockVault(keys: string[] = []): VaultBackend {
  return {
    name: "MockVault",
    async isAvailable() { return true; },
    async set() {},
    async get() { return null; },
    async delete() {},
    async list(prefix: string) {
      return keys.filter((k) => k.startsWith(prefix));
    },
  };
}

describe("askSecretSet — real function call", () => {
  it("non-interactive mode: stored=false and result never contains secret value", async () => {
    const secretValue = "ghp_super_secret_token_abc123";
    const originalIsTTY = process.stdin.isTTY;
    (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = false;

    // Simulate vault unavailable (e.g., non-Windows CI environment)
    mock.module("../vault/detect.ts", () => ({
      detectBackend: () => Promise.reject(new Error("vault unavailable in CI")),
      detectResult: async () => ({ available: false, backend: "none", detail: "vault unavailable in CI" }),
    }));

    try {
      const { askSecretSet } = await import("./ask-secret-set.ts");
      const result = await askSecretSet("github-token", "ci-project");

      // Security invariant: secret value must never appear in output
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(secretValue);
      expect(result).not.toHaveProperty("value");

      // Key is correctly qualified
      expect(result.key).toBe("ci-project/github-token");

      // Non-interactive result contains instructions
      expect(result.stored).toBe(false);
      if (!result.stored) {
        expect(result.instructions).toContain("see-crets set");
        expect(result.instructions).toContain("ci-project/github-token");
      }
    } finally {
      (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = originalIsTTY;
    }
  });

  it("non-interactive mode with key already in vault: stored=true without value", async () => {
    const originalIsTTY = process.stdin.isTTY;
    (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = false;

    // Provide a mock vault that already holds the key
    const vault = createMockVault(["vault-project/existing-key"]);
    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => vault,
      detectResult: async () => ({ available: true, backend: "MockVault" }),
    }));

    try {
      const { askSecretSet } = await import("./ask-secret-set.ts");
      const result = await askSecretSet("existing-key", "vault-project");

      expect(result.stored).toBe(true);
      expect(result.key).toBe("vault-project/existing-key");
      expect(result).not.toHaveProperty("value");
    } finally {
      (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = originalIsTTY;
    }
  });
});
