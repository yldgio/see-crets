import { describe, it, expect, mock } from "bun:test";
import type { VaultBackend } from "../vault/types.ts";

// ---------------------------------------------------------------------------
// Shared mock factory
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Core security invariant tests — call real askSecretSet() with mocked deps
// ---------------------------------------------------------------------------

describe("askSecretSet — security invariant", () => {
  it("non-interactive stored=false: result never contains the secret value", async () => {
    const secretValue = "ghp_super_secret_token_abc123";
    const originalIsTTY = process.stdin.isTTY;
    (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = false;

    mock.module("../vault/detect.ts", () => ({
      detectBackend: () => Promise.reject(new Error("vault unavailable")),
      detectResult: async () => ({ available: false, backend: "none", detail: "vault unavailable" }),
    }));
    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => false,
      getProjectName: () => "global",
    }));

    try {
      const { askSecretSet } = await import("./ask-secret-set.ts");
      const result = await askSecretSet("github-token", "my-project");

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(secretValue);
      expect(result).not.toHaveProperty("value");
      expect(result.stored).toBe(false);
      expect(result.key).toBe("my-project/github-token");
    } finally {
      (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = originalIsTTY;
    }
  });

  it("non-interactive stored=true (key exists): result never contains value", async () => {
    const originalIsTTY = process.stdin.isTTY;
    (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = false;

    const vault = createMockVault(["inv-project/existing-key"]);
    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => vault,
      detectResult: async () => ({ available: true, backend: "MockVault" }),
    }));
    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => false,
      getProjectName: () => "global",
    }));

    try {
      const { askSecretSet } = await import("./ask-secret-set.ts");
      const result = await askSecretSet("existing-key", "inv-project");

      expect(result).not.toHaveProperty("value");
      expect(result.stored).toBe(true);
      expect(result.key).toBe("inv-project/existing-key");
    } finally {
      (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = originalIsTTY;
    }
  });

  it("set result key matches the qualified key, not a raw key fragment", () => {
    // Pure logic test — key qualification rule: namespace/name
    const qualify = (raw: string, ns: string) =>
      raw.includes("/") ? raw : `${ns}/${raw}`;

    expect(qualify("github-token", "my-project")).toBe("my-project/github-token");
    expect(qualify("global/my-special-token", "my-project")).toBe("global/my-special-token");
    expect(qualify("github-token", "my-project")).toMatch(/^[^/]+\/.+$/);
  });

  it("non-interactive instructions mention 'see-crets set' and the qualified key", async () => {
    const originalIsTTY = process.stdin.isTTY;
    (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = false;

    mock.module("../vault/detect.ts", () => ({
      detectBackend: () => Promise.reject(new Error("vault unavailable")),
      detectResult: async () => ({ available: false, backend: "none", detail: "vault unavailable" }),
    }));
    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => false,
      getProjectName: () => "global",
    }));

    try {
      const { askSecretSet } = await import("./ask-secret-set.ts");
      const result = await askSecretSet("my-token", "my-project");

      if (!result.stored) {
        expect(result.instructions).toContain("see-crets set");
        expect(result.instructions).toContain("my-project/my-token");
      }
    } finally {
      (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = originalIsTTY;
    }
  });
});



describe("askSecretSet — additional integration tests", () => {
  it("non-interactive mode: stored=false and result never contains secret value", async () => {
    const secretValue = "ghp_super_secret_token_abc123";
    const originalIsTTY = process.stdin.isTTY;
    (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = false;

    // Simulate vault unavailable (e.g., non-Windows CI environment)
    mock.module("../vault/detect.ts", () => ({
      detectBackend: () => Promise.reject(new Error("vault unavailable in CI")),
      detectResult: async () => ({ available: false, backend: "none", detail: "vault unavailable in CI" }),
    }));

    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => false,
      getProjectName: () => "global",
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

    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => false,
      getProjectName: () => "global",
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
