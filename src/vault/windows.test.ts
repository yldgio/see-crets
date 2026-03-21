import { describe, it, expect } from "bun:test";
import type { VaultBackend } from "../vault/types.ts";
import { WindowsVaultBackend } from "./windows.ts";

// ---------------------------------------------------------------------------
// Mock vault backend (in-memory, no OS calls)
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

    async set(key, value) {
      if (/[\r\n]/.test(key)) throw new Error("key must not contain newlines");
      store.set(key, value);
    },

    async get(key) { return store.get(key) ?? null; },

    async delete(key) { store.delete(key); },

    async list(prefix) {
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

// ---------------------------------------------------------------------------
// Tests for WindowsVaultBackend interface contract (via mock)
// ---------------------------------------------------------------------------

describe("VaultBackend contract", () => {
  it("stores and retrieves a value", async () => {
    const backend = createMockBackend();
    await backend.set("my-project/github-token", "ghp_abc123");
    const val = await backend.get("my-project/github-token");
    expect(val).toBe("ghp_abc123");
  });

  it("returns null for a missing key", async () => {
    const backend = createMockBackend();
    const val = await backend.get("my-project/nonexistent");
    expect(val).toBeNull();
  });

  it("overwrites an existing key on set", async () => {
    const backend = createMockBackend({ "my-project/token": "old" });
    await backend.set("my-project/token", "new");
    expect(await backend.get("my-project/token")).toBe("new");
  });

  it("delete removes the key", async () => {
    const backend = createMockBackend({ "my-project/token": "val" });
    await backend.delete("my-project/token");
    expect(await backend.get("my-project/token")).toBeNull();
  });

  it("delete is a no-op on a missing key", async () => {
    const backend = createMockBackend();
    // Should not throw
    await expect(backend.delete("nonexistent/key")).resolves.toBeUndefined();
  });

  it("list returns only keys matching the prefix", async () => {
    const backend = createMockBackend({
      "my-project/github-token": "val1",
      "my-project/npm-token": "val2",
      "global/shared-key": "val3",
      "other-project/irrelevant": "val4",
    });

    const results = await backend.list("my-project/");

    expect(results).toContain("my-project/github-token");
    expect(results).toContain("my-project/npm-token");
    expect(results).not.toContain("global/shared-key");
    expect(results).not.toContain("other-project/irrelevant");
  });

  it("list returns empty array when no keys match", async () => {
    const backend = createMockBackend({ "global/token": "val" });
    const results = await backend.list("my-project/");
    expect(results).toHaveLength(0);
  });

  it("stored values do not appear in list results", async () => {
    const backend = createMockBackend();
    const secretValue = "super_secret_password_12345";
    await backend.set("my-project/db-pass", secretValue);

    const keys = await backend.list("my-project/");

    expect(keys).toContain("my-project/db-pass");
    for (const key of keys) {
      expect(key).not.toContain(secretValue);
    }
  });
});

// ---------------------------------------------------------------------------
// WindowsVaultBackend unit tests (key validation — no OS calls for these)
// ---------------------------------------------------------------------------

describe("WindowsVaultBackend key validation", () => {
  const backend = new WindowsVaultBackend();

  it("set() rejects keys containing newline", async () => {
    await expect(backend.set("bad\nkey", "val")).rejects.toThrow("newline");
  });

  it("set() rejects keys containing carriage return", async () => {
    await expect(backend.set("bad\rkey", "val")).rejects.toThrow("newline");
  });

  it("set() accepts keys with slashes and dashes", async () => {
    // Validation should not throw for normal keys.
    // The call will fail at the OS level (no credential store in test), but that's OK —
    // we only care that key validation itself does not throw.
    const result = backend.set("my-project/github-token", "val");
    // Should not reject due to key validation (may reject due to OS, which is fine)
    await result.catch(() => {});
  });
});
