import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { VaultBackend } from "../vault/types.ts";
import { WindowsDPAPIFileBackend } from "./windows-dpapi.ts";
import { validateKey } from "./shared.ts";

// ---------------------------------------------------------------------------
// Mock backend that mirrors WindowsDPAPIFileBackend's contract (no OS calls)
// ---------------------------------------------------------------------------

function createMockDPAPIBackend(
  initial?: Record<string, string>
): VaultBackend & { _store: Map<string, string> } {
  const store = new Map<string, string>(
    initial ? Object.entries(initial) : []
  );

  return {
    name: "Windows DPAPI File",
    _store: store,

    async isAvailable() { return true; },

    async set(key, value) {
      if (/[\r\n]/.test(key)) throw new Error("key must not contain newlines");
      if (key !== key.trim()) throw new Error("key must not have leading or trailing whitespace");
      if (key.split("/").some((seg) => seg === ".." || seg === ".")) {
        throw new Error("key must not contain path traversal segments");
      }
      store.set(key, value);
    },

    async get(key) { return store.get(key) ?? null; },

    async delete(key) { store.delete(key); },

    async list(prefix) {
      if (/[*?]/.test(prefix)) throw new Error("prefix must not contain wildcard characters");
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

// ---------------------------------------------------------------------------
// VaultBackend contract tests (via mock — no OS calls)
// ---------------------------------------------------------------------------

describe("WindowsDPAPIFileBackend contract", () => {
  it("stores and retrieves a value", async () => {
    const b = createMockDPAPIBackend();
    await b.set("proj/api-key", "sk-abc123");
    expect(await b.get("proj/api-key")).toBe("sk-abc123");
  });

  it("returns null for a missing key", async () => {
    const b = createMockDPAPIBackend();
    expect(await b.get("proj/nonexistent")).toBeNull();
  });

  it("overwrites an existing key on set", async () => {
    const b = createMockDPAPIBackend({ "proj/token": "old" });
    await b.set("proj/token", "new");
    expect(await b.get("proj/token")).toBe("new");
  });

  it("delete removes the key", async () => {
    const b = createMockDPAPIBackend({ "proj/token": "val" });
    await b.delete("proj/token");
    expect(await b.get("proj/token")).toBeNull();
  });

  it("delete is a no-op on a missing key", async () => {
    const b = createMockDPAPIBackend();
    await expect(b.delete("nonexistent/key")).resolves.toBeUndefined();
  });

  it("list returns only keys matching the prefix", async () => {
    const b = createMockDPAPIBackend({
      "proj/github-token": "val1",
      "proj/npm-token": "val2",
      "global/shared-key": "val3",
      "other/irrelevant": "val4",
    });
    const result = await b.list("proj/");
    expect(result).toContain("proj/github-token");
    expect(result).toContain("proj/npm-token");
    expect(result).not.toContain("global/shared-key");
    expect(result).not.toContain("other/irrelevant");
  });

  it("list returns empty array when no keys match", async () => {
    const b = createMockDPAPIBackend({ "global/token": "val" });
    expect(await b.list("proj/")).toHaveLength(0);
  });

  it("list rejects wildcard characters", async () => {
    const b = createMockDPAPIBackend();
    await expect(b.list("proj/*")).rejects.toThrow("wildcard");
    await expect(b.list("proj/?")).rejects.toThrow("wildcard");
  });

  it("stored values do not appear in list results", async () => {
    const b = createMockDPAPIBackend();
    const secret = "super_secret_password_99";
    await b.set("proj/db-pass", secret);
    const keys = await b.list("proj/");
    expect(keys).toContain("proj/db-pass");
    for (const k of keys) expect(k).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------
// WindowsDPAPIFileBackend key validation (no OS calls)
// ---------------------------------------------------------------------------

describe("WindowsDPAPIFileBackend key validation", () => {
  const backend = new WindowsDPAPIFileBackend();

  it("set() rejects keys containing newline", async () => {
    await expect(backend.set("bad\nkey", "val")).rejects.toThrow("newline");
  });

  it("set() rejects keys containing carriage return", async () => {
    await expect(backend.set("bad\rkey", "val")).rejects.toThrow("newline");
  });

  it("set() rejects keys with leading whitespace", async () => {
    await expect(backend.set(" leading", "val")).rejects.toThrow("whitespace");
  });

  it("set() rejects keys with trailing whitespace", async () => {
    await expect(backend.set("trailing ", "val")).rejects.toThrow("whitespace");
  });

  it("set() rejects path traversal (..) segments", async () => {
    await expect(backend.set("proj/../other/key", "val")).rejects.toThrow("path traversal");
  });

  it("set() rejects path traversal (.) segments", async () => {
    await expect(backend.set("proj/./key", "val")).rejects.toThrow("path traversal");
  });

  it("set() accepts valid namespaced keys", async () => {
    // validateKey (from shared.ts) must not throw for these — no OS calls happen before validation.
    expect(() => validateKey("proj/github-token")).not.toThrow();
    expect(() => validateKey("global/npm-token")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// WindowsDPAPIFileBackend file error handling (injectable vault dir)
// ---------------------------------------------------------------------------

describe("WindowsDPAPIFileBackend file error handling", () => {
  const testDir = join(tmpdir(), `dpapi-test-${Date.now()}`);
  const vaultFile = join(testDir, "vault.dpapi");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("isAvailable() returns false when vault dir is empty (no APPDATA env)", () => {
    // Simulate missing user-profile env by passing empty string as override.
    // The constructor accepts an override dir; empty string means unavailable.
    const backend = new WindowsDPAPIFileBackend("");
    // isAvailable() checks this.vaultDir first — "" triggers early return false.
    return expect(backend.isAvailable()).resolves.toBe(false);
  });

  it("get() throws when vault file has corrupt JSON", async () => {
    writeFileSync(vaultFile, "{ this is: not valid json }", "utf8");
    const backend = new WindowsDPAPIFileBackend(testDir);
    // Any method that calls _readVault() should throw, not return silently.
    await expect(backend.get("any/key")).rejects.toThrow("could not be parsed");
  });

  it("set() throws when vault file has corrupt JSON", async () => {
    writeFileSync(vaultFile, "CORRUPT", "utf8");
    const backend = new WindowsDPAPIFileBackend(testDir);
    await expect(backend.set("any/key", "val")).rejects.toThrow("could not be parsed");
  });

  it("list() throws when vault file has corrupt JSON", async () => {
    writeFileSync(vaultFile, "null", "utf8");
    const backend = new WindowsDPAPIFileBackend(testDir);
    // null parses fine but isn't a Record — JSON.parse("null") returns null,
    // Object.keys(null) throws TypeError in strict mode or returns []
    // Either way — not silently empty.
    // This tests _readVault parse success but incorrect shape (null → TypeError on Object.keys).
    await expect(backend.list("")).rejects.toThrow();
  });

  it("delete() on missing key is a no-op (does not throw)", async () => {
    const backend = new WindowsDPAPIFileBackend(testDir);
    // Vault file doesn't exist — _readVault returns {}; delete is a no-op.
    await expect(backend.delete("nonexistent/key")).resolves.toBeUndefined();
  });

  it("list() returns empty array when vault file does not exist", async () => {
    const backend = new WindowsDPAPIFileBackend(testDir);
    expect(await backend.list("")).toEqual([]);
  });
});

