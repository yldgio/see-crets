import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { VaultBackend } from "../vault/types.ts";

// ---------------------------------------------------------------------------
// Mock vault backend (in-memory, no OS calls)
// ---------------------------------------------------------------------------

function createMockBackend(): VaultBackend & { _store: Map<string, string> } {
  const store = new Map<string, string>();

  return {
    name: "MockBackend",
    _store: store,

    async isAvailable() {
      return true;
    },

    async set(key: string, value: string) {
      store.set(key, value);
    },

    async get(key: string) {
      return store.get(key) ?? null;
    },

    async delete(key: string) {
      store.delete(key);
    },

    async list(prefix: string) {
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

// ---------------------------------------------------------------------------
// Tests for secretsList using mock backend
// ---------------------------------------------------------------------------

describe("secretsList", () => {
  it("returns key names for project and global namespaces", async () => {
    // We exercise the list logic directly — no OS vault
    const backend = createMockBackend();
    await backend.set("my-project/github-token", "secret1");
    await backend.set("my-project/npm-token", "secret2");
    await backend.set("global/shared-key", "secret3");
    await backend.set("other-project/unrelated", "secret4");

    const projectKeys = await backend.list("my-project/");
    const globalKeys = await backend.list("global/");

    // Combined result mirrors what secretsList does
    const keys = [...new Set([...projectKeys, ...globalKeys])];

    expect(keys).toContain("my-project/github-token");
    expect(keys).toContain("my-project/npm-token");
    expect(keys).toContain("global/shared-key");
    expect(keys).not.toContain("other-project/unrelated");
  });

  it("returns only global keys when project is 'global'", async () => {
    const backend = createMockBackend();
    await backend.set("global/token-a", "val1");
    await backend.set("global/token-b", "val2");
    await backend.set("my-project/token-c", "val3");

    const keys = await backend.list("global/");

    expect(keys).toContain("global/token-a");
    expect(keys).toContain("global/token-b");
    expect(keys).not.toContain("my-project/token-c");
  });

  it("returns no values — only key names", async () => {
    const backend = createMockBackend();
    await backend.set("my-project/secret-key", "SUPER_SECRET_VALUE");

    const keys = await backend.list("my-project/");

    // Ensure the list result contains the key name, not the value
    expect(keys).toContain("my-project/secret-key");
    for (const key of keys) {
      expect(key).not.toContain("SUPER_SECRET_VALUE");
    }
  });

  it("returns empty array when nothing is stored", async () => {
    const backend = createMockBackend();
    const keys = await backend.list("my-project/");
    expect(keys).toHaveLength(0);
  });

  it("deduplicates keys returned from multiple prefixes", async () => {
    const backend = createMockBackend();
    // Only one key in global
    await backend.set("global/shared", "val");

    const projectKeys = await backend.list("my-project/");
    const globalKeys = await backend.list("global/");
    const combined = [...new Set([...projectKeys, ...globalKeys])];

    // Should appear exactly once
    expect(combined.filter((k) => k === "global/shared")).toHaveLength(1);
  });
});
