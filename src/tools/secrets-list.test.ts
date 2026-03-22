import { describe, it, expect, mock } from "bun:test";
import type { VaultBackend } from "../vault/types.ts";

// ---------------------------------------------------------------------------
// Shared mock factory — in-memory backend, no OS calls
// ---------------------------------------------------------------------------

function createMockVaultFromStore(store: Map<string, string>): VaultBackend {
  return {
    name: "MockVault",
    async isAvailable() { return true; },
    async set() {},
    async get() { return null; },
    async delete() {},
    async list(prefix: string) {
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

// ---------------------------------------------------------------------------
// secretsList() — real function call tests via mocked dependencies
// ---------------------------------------------------------------------------

describe("secretsList", () => {
  it("returns project and global keys, excludes other namespaces", async () => {
    const mockStore = new Map<string, string>([
      ["my-project/github-token", "secret1"],
      ["my-project/npm-token", "secret2"],
      ["global/shared-key", "secret3"],
      ["other-project/unrelated", "secret4"],
    ]);

    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVaultFromStore(mockStore),
      detectResult: async () => ({ available: true, backend: "MockBackend" }),
    }));
    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => true,
      getProjectName: () => "my-project",
    }));

    const { secretsList } = await import("./secrets-list.ts");
    const result = await secretsList();

    expect(result.keys).toContain("my-project/github-token");
    expect(result.keys).toContain("my-project/npm-token");
    expect(result.keys).toContain("global/shared-key");
    expect(result.keys).not.toContain("other-project/unrelated");
    expect(result.namespace).toBe("my-project");
  });

  it("returns only global keys when not in a git repo", async () => {
    const mockStore = new Map<string, string>([
      ["global/token-a", "val1"],
      ["global/token-b", "val2"],
      ["my-project/token-c", "val3"],
    ]);

    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVaultFromStore(mockStore),
      detectResult: async () => ({ available: true, backend: "MockBackend" }),
    }));
    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => false,
      getProjectName: () => "my-project",
    }));

    const { secretsList } = await import("./secrets-list.ts");
    const result = await secretsList();

    expect(result.keys).toContain("global/token-a");
    expect(result.keys).toContain("global/token-b");
    expect(result.keys).not.toContain("my-project/token-c");
    expect(result.namespace).toBe("global");
    expect(result.note).toContain("global namespace");
  });

  it("returns no values — only key names", async () => {
    const mockStore = new Map<string, string>([
      ["vals-project/secret-key", "SUPER_SECRET_VALUE"],
    ]);

    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVaultFromStore(mockStore),
      detectResult: async () => ({ available: true, backend: "MockBackend" }),
    }));
    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => true,
      getProjectName: () => "vals-project",
    }));

    const { secretsList } = await import("./secrets-list.ts");
    const result = await secretsList();

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SUPER_SECRET_VALUE");
    expect(result.keys).toContain("vals-project/secret-key");
  });

  it("deduplicates keys returned from multiple prefixes", async () => {
    const mockStore = new Map<string, string>([
      ["global/shared", "val"],
    ]);

    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVaultFromStore(mockStore),
      detectResult: async () => ({ available: true, backend: "MockBackend" }),
    }));
    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => true,
      getProjectName: () => "dedup-project",
    }));

    const { secretsList } = await import("./secrets-list.ts");
    const result = await secretsList();

    expect(result.keys.filter((k) => k === "global/shared")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Additional secretsList() integration tests
// ---------------------------------------------------------------------------

describe("secretsList — real function call", () => {
  it("returns project and global keys, never values", async () => {
    const mockStore = new Map<string, string>([
      ["list-project/token-a", "secret1"],
      ["global/shared-token", "secret2"],
      ["other-project/unrelated", "secret3"],
    ]);

    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVaultFromStore(mockStore),
      detectResult: async () => ({ available: true, backend: "MockBackend" }),
    }));

    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => true,
      getProjectName: () => "list-project",
    }));

    const { secretsList } = await import("./secrets-list.ts");
    const result = await secretsList();

    expect(result.keys).toContain("list-project/token-a");
    expect(result.keys).toContain("global/shared-token");
    expect(result.keys).not.toContain("other-project/unrelated");
    expect(result.namespace).toBe("list-project");

    // Critical: result must never contain secret values
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret1");
    expect(serialized).not.toContain("secret2");
  });

  it("deduplicates keys when project prefix overlaps global", async () => {
    const mockStore = new Map<string, string>([
      ["global/shared", "val"],
    ]);

    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVaultFromStore(mockStore),
      detectResult: async () => ({ available: true, backend: "MockBackend" }),
    }));

    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => true,
      getProjectName: () => "dedup-project",
    }));

    const { secretsList } = await import("./secrets-list.ts");
    const result = await secretsList();

    // global/shared should appear exactly once
    expect(result.keys.filter((k) => k === "global/shared")).toHaveLength(1);
  });

  it("project override takes precedence over git root", async () => {
    const mockStore = new Map<string, string>([
      ["override-ns/my-key", "val"],
    ]);

    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => createMockVaultFromStore(mockStore),
      detectResult: async () => ({ available: true, backend: "MockBackend" }),
    }));

    mock.module("../utils/git.ts", () => ({
      isInGitRepo: () => true,
      getProjectName: () => "git-project",
    }));

    const { secretsList } = await import("./secrets-list.ts");
    const result = await secretsList("override-ns");

    expect(result.namespace).toBe("override-ns");
    expect(result.keys).toContain("override-ns/my-key");
  });
});
