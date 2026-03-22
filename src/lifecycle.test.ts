import { describe, it, expect } from "bun:test";
import type { VaultBackend } from "./vault/types.ts";
import { resolveKey, namespaceOf, deleteSecret, purgeSecrets, rotateSecret } from "./lifecycle.ts";

// ---------------------------------------------------------------------------
// Mock vault factory
// ---------------------------------------------------------------------------

function createMockVault(store: Map<string, string>): VaultBackend & {
  deleteCalls: string[];
  setCalls: Array<{ key: string; value: string }>;
} {
  const deleteCalls: string[] = [];
  const setCalls: Array<{ key: string; value: string }> = [];

  return {
    name: "MockVault",
    async isAvailable() { return true; },
    async get(key) { return store.get(key) ?? null; },
    async set(key, value) { setCalls.push({ key, value }); store.set(key, value); },
    async delete(key) { deleteCalls.push(key); store.delete(key); },
    async list(prefix) { return [...store.keys()].filter((k) => k.startsWith(prefix)); },
    deleteCalls,
    setCalls,
  };
}

// ---------------------------------------------------------------------------
// resolveKey — bypass git with projectOverride to avoid mocking git module
// ---------------------------------------------------------------------------

describe("resolveKey", () => {
  it("uses projectOverride when provided (bare key)", () => {
    expect(resolveKey("github-token", "my-project")).toBe("my-project/github-token");
  });

  it("uses projectOverride for a different namespace", () => {
    expect(resolveKey("npm-token", "override-ns")).toBe("override-ns/npm-token");
  });

  it("returns already-qualified key unchanged (override ignored)", () => {
    expect(resolveKey("my-project/github-token", "override")).toBe("my-project/github-token");
  });

  it("returns already-qualified key unchanged (no override)", () => {
    // Key already has a slash — returned verbatim regardless of git state.
    expect(resolveKey("global/npm-token")).toBe("global/npm-token");
  });
});

// ---------------------------------------------------------------------------
// namespaceOf helper
// ---------------------------------------------------------------------------

describe("namespaceOf", () => {
  it("extracts namespace from a qualified key", () => {
    expect(namespaceOf("my-project/github-token")).toBe("my-project");
  });

  it("returns 'global' for keys with no slash", () => {
    expect(namespaceOf("bare-key")).toBe("global");
  });
});

// ---------------------------------------------------------------------------
// deleteSecret
// ---------------------------------------------------------------------------

describe("deleteSecret", () => {
  it("calls backend.delete with the qualified key", async () => {
    const store = new Map<string, string>([["my-project/github-token", "secret"]]);
    const vault = createMockVault(store);

    const result = await deleteSecret(vault, "my-project/github-token");

    expect(vault.deleteCalls).toContain("my-project/github-token");
    expect(result.deleted).toBe(true);
    expect(result.key).toBe("my-project/github-token");
    expect(result.namespace).toBe("my-project");
  });

  it("removes the key from the store", async () => {
    const store = new Map<string, string>([["project/token", "val"]]);
    const vault = createMockVault(store);

    await deleteSecret(vault, "project/token");

    expect(store.has("project/token")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// purgeSecrets
// ---------------------------------------------------------------------------

describe("purgeSecrets", () => {
  it("deletes all keys under the project namespace", async () => {
    const store = new Map<string, string>([
      ["my-project/token-a", "val1"],
      ["my-project/token-b", "val2"],
      ["global/shared", "val3"],
    ]);
    const vault = createMockVault(store);

    const result = await purgeSecrets(vault, "my-project");

    expect(result.purged).toBe(2);
    expect(result.namespace).toBe("my-project");
    expect(result.keys).toContain("my-project/token-a");
    expect(result.keys).toContain("my-project/token-b");
    expect(store.has("global/shared")).toBe(true);
    expect(vault.deleteCalls).not.toContain("global/shared");
  });

  it("returns purged: 0 when namespace has no keys", async () => {
    const store = new Map<string, string>();
    const vault = createMockVault(store);

    const result = await purgeSecrets(vault, "empty-project");

    expect(result.purged).toBe(0);
    expect(result.keys).toHaveLength(0);
  });

  it("does NOT delete global keys when purging a project namespace", async () => {
    const store = new Map<string, string>([
      ["proj/key", "v1"],
      ["global/key", "v2"],
    ]);
    const vault = createMockVault(store);

    await purgeSecrets(vault, "proj");

    expect(vault.deleteCalls).toContain("proj/key");
    expect(vault.deleteCalls).not.toContain("global/key");
  });

  it("throws when attempting to purge the global namespace", async () => {
    const store = new Map<string, string>([["global/secret", "val"]]);
    const vault = createMockVault(store);

    await expect(purgeSecrets(vault, "global")).rejects.toThrow(
      "Refusing to purge the global namespace"
    );
    // global secret must not be touched
    expect(vault.deleteCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// rotateSecret
// ---------------------------------------------------------------------------

describe("rotateSecret", () => {
  it("calls backend.set with the new value", async () => {
    const store = new Map<string, string>([["my-project/token", "old-value"]]);
    const vault = createMockVault(store);

    const result = await rotateSecret(vault, "my-project/token", "new-value");

    expect(vault.setCalls).toEqual([{ key: "my-project/token", value: "new-value" }]);
    expect(result.rotated).toBe(true);
    expect(result.key).toBe("my-project/token");
    expect(result.namespace).toBe("my-project");
  });

  it("does NOT call backend.delete (overwrites in place)", async () => {
    const store = new Map<string, string>([["proj/api-key", "old"]]);
    const vault = createMockVault(store);

    await rotateSecret(vault, "proj/api-key", "new");

    expect(vault.deleteCalls).toHaveLength(0);
  });

  it("updates the stored value to the new value", async () => {
    const store = new Map<string, string>([["proj/api-key", "old"]]);
    const vault = createMockVault(store);

    await rotateSecret(vault, "proj/api-key", "new-rotated");

    expect(store.get("proj/api-key")).toBe("new-rotated");
  });

  it("throws when the key does not exist (no silent creation)", async () => {
    const store = new Map<string, string>(); // empty vault
    const vault = createMockVault(store);

    await expect(
      rotateSecret(vault, "proj/missing-key", "new-value")
    ).rejects.toThrow("key does not exist");

    // Must NOT have written anything to the vault
    expect(vault.setCalls).toHaveLength(0);
    expect(store.has("proj/missing-key")).toBe(false);
  });

  it("never returns the new secret value in the result", async () => {
    const store = new Map<string, string>([["my-project/token", "old"]]);
    const vault = createMockVault(store);

    const result = await rotateSecret(vault, "my-project/token", "super-secret-value");

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("super-secret-value");
  });
});
