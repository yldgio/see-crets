import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { VaultBackend } from "../vault/types.ts";
import { MacosVaultBackend, clearKeychainListCache } from "./macos.ts";

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
      if (key !== key.trim()) throw new Error("key must not have leading or trailing whitespace");
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
// VaultBackend contract tests (via in-memory mock -- no OS calls)
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
// MacosVaultBackend unit tests (key validation -- no OS calls for these)
// ---------------------------------------------------------------------------

describe("MacosVaultBackend key validation", () => {
  const backend = new MacosVaultBackend();

  it("set() rejects keys containing newline", async () => {
    await expect(backend.set("bad\nkey", "val")).rejects.toThrow("newline");
  });

  it("set() rejects keys containing carriage return", async () => {
    await expect(backend.set("bad\rkey", "val")).rejects.toThrow("newline");
  });

  it("set() rejects keys with leading whitespace", async () => {
    await expect(backend.set(" leading-space", "val")).rejects.toThrow("whitespace");
  });

  it("set() rejects keys with trailing whitespace", async () => {
    await expect(backend.set("trailing-space ", "val")).rejects.toThrow("whitespace");
  });

  it("set() rejects keys with path traversal segments", async () => {
    await expect(backend.set("../escape", "val")).rejects.toThrow("traversal");
    await expect(backend.set("project/../escape", "val")).rejects.toThrow("traversal");
  });

  it("set() rejects values containing newlines (security -i command injection)", async () => {
    await expect(backend.set("key", "value\nwith\nnewlines")).rejects.toThrow("newline");
    await expect(backend.set("key", "value\rwith\rcr")).rejects.toThrow("newline");
  });

  it("set() accepts keys with slashes and dashes", async () => {
    const validatingBackend: VaultBackend = {
      name: backend.name,
      async isAvailable() { return true; },
      async set(key: string, _value: string) {
        if (/[\r\n]/.test(key)) {
          throw new Error("key must not contain newlines");
        }
        if (key !== key.trim()) {
          throw new Error("key must not have leading or trailing whitespace");
        }
      },
      async get(_key: string) { return null; },
      async delete(_key: string) {},
      async list(_prefix: string) { return []; },
    };

    await expect(
      validatingBackend.set("my-project/github-token", "val"),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MacosVaultBackend list() -- dump-keychain keychain-scoping tests
// ---------------------------------------------------------------------------

describe("MacosVaultBackend list() -- keychain scoping", () => {
  const backend = new MacosVaultBackend();

  const HOME = "/Users/testuser";

  const keychainDump = [
    `keychain: "${HOME}/Library/Keychains/login.keychain-db"`,
    ``,
    `keychain: "valid see-crets entry"`,
    `"svce"<blob>="see-crets:my-project/github-token"`,
    `"acct"<blob>="see-crets"`,
    ``,
    `keychain: "wrong account sentinel -- must be excluded"`,
    `"svce"<blob>="see-crets:my-project/npm-token"`,
    `"acct"<blob>="other-app"`,
    ``,
    `keychain: "wrong service prefix -- must be excluded"`,
    `"svce"<blob>="not-see-crets:my-project/key"`,
    `"acct"<blob>="see-crets"`,
  ].join("\n");

  let savedHome: string | undefined;

  beforeEach(() => {
    clearKeychainListCache(); // each test must see a fresh cache
    savedHome = process.env["HOME"];
  });

  afterEach(() => {
    if (savedHome !== undefined) {
      process.env["HOME"] = savedHome;
    } else {
      delete process.env["HOME"];
    }
  });

  it("passes the login keychain path to dump-keychain when HOME is set", async () => {
    process.env["HOME"] = HOME;
    let capturedArgs: string[] | undefined;
    const runner = (args: string[]) => {
      capturedArgs = args;
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    await backend.list("my-project/", runner);
    expect(capturedArgs).toEqual([
      "security",
      "dump-keychain",
      `${HOME}/Library/Keychains/login.keychain-db`,
    ]);
  });

  it("omits the keychain path from dump-keychain when HOME is not set", async () => {
    delete process.env["HOME"];
    let capturedArgs: string[] | undefined;
    const runner = (args: string[]) => {
      capturedArgs = args;
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    await backend.list("my-project/", runner);
    expect(capturedArgs).toEqual(["security", "dump-keychain"]);
  });

  it("filters by TARGET_PREFIX and ACCOUNT sentinel -- returns only matching keys", async () => {
    process.env["HOME"] = HOME;
    const runner = (_args: string[]) => ({
      stdout: keychainDump,
      stderr: "",
      exitCode: 0,
    });
    const results = await backend.list("my-project/", runner);
    expect(results).toContain("my-project/github-token");
    expect(results).not.toContain("my-project/npm-token");
    expect(results).not.toContain("my-project/key");
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// MacosVaultBackend list() -- memoization cache tests (#53)
// ---------------------------------------------------------------------------

describe("MacosVaultBackend list() -- memoization cache", () => {
  const backend = new MacosVaultBackend();
  const HOME = "/Users/testuser";

  const keychainDump = [
    `keychain: "entry-a"`,
    `"svce"<blob>="see-crets:my-project/token-a"`,
    `"acct"<blob>="see-crets"`,
    ``,
    `keychain: "entry-b"`,
    `"svce"<blob>="see-crets:other-project/token-b"`,
    `"acct"<blob>="see-crets"`,
  ].join("\n");

  let savedHome: string | undefined;

  beforeEach(() => {
    clearKeychainListCache();
    savedHome = process.env["HOME"];
    process.env["HOME"] = HOME;
  });

  afterEach(() => {
    clearKeychainListCache();
    if (savedHome !== undefined) {
      process.env["HOME"] = savedHome;
    } else {
      delete process.env["HOME"];
    }
  });

  it("calls the runner only once across multiple list() invocations", async () => {
    let callCount = 0;
    const runner = (_args: string[]) => {
      callCount++;
      return { stdout: keychainDump, stderr: "", exitCode: 0 };
    };

    await backend.list("my-project/", runner);
    await backend.list("my-project/", runner);
    await backend.list("other-project/", runner);

    expect(callCount).toBe(1);
  });

  it("returns consistent results from the cache for the same prefix", async () => {
    const runner = (_args: string[]) => ({
      stdout: keychainDump,
      stderr: "",
      exitCode: 0,
    });

    const first = await backend.list("my-project/", runner);
    const second = await backend.list("my-project/", runner);

    expect(first).toEqual(second);
    expect(first).toContain("my-project/token-a");
  });

  it("returns the correct filtered subset from the cache for different prefixes", async () => {
    const runner = (_args: string[]) => ({
      stdout: keychainDump,
      stderr: "",
      exitCode: 0,
    });

    const projectA = await backend.list("my-project/", runner);
    const projectB = await backend.list("other-project/", runner);

    expect(projectA).toContain("my-project/token-a");
    expect(projectA).not.toContain("other-project/token-b");
    expect(projectB).toContain("other-project/token-b");
    expect(projectB).not.toContain("my-project/token-a");
  });

  it("clearKeychainListCache() causes the next list() to re-fetch from the runner", async () => {
    let callCount = 0;
    const runner = (_args: string[]) => {
      callCount++;
      return { stdout: keychainDump, stderr: "", exitCode: 0 };
    };

    await backend.list("my-project/", runner);
    expect(callCount).toBe(1);

    clearKeychainListCache();

    await backend.list("my-project/", runner);
    expect(callCount).toBe(2);
  });
});
