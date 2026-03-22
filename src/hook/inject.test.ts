import { describe, it, expect, mock } from "bun:test";
import type { VaultBackend } from "../vault/types.ts";
import { SecretNotFoundError } from "./inject.ts";

// ---------------------------------------------------------------------------
// Shared mock factory — in-memory backend, no OS calls
// ---------------------------------------------------------------------------

function createMockBackend(store: Map<string, string>): VaultBackend {
  return {
    name: "MockVault",
    async isAvailable() { return true; },
    async set() {},
    async get(key: string) { return store.get(key) ?? null; },
    async delete() {},
    async list(prefix: string) {
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

// ---------------------------------------------------------------------------
// injectSecrets() tests
// ---------------------------------------------------------------------------

describe("injectSecrets", () => {
  it("resolves a single placeholder and returns env map", async () => {
    const store = new Map([["my-app/github-token", "ghp_supersecret123"]]);
    const backend = createMockBackend(store);

    mock.module("../vault/detect.ts", () => ({
      detectBackend: async () => backend,
    }));

    const { injectSecrets } = await import("./inject.ts");
    const result = await injectSecrets(
      "gh pr list --token {{SECRET:my-app/github-token}}",
      backend,
    );

    // Placeholder replaced with a shell var reference (brace form on Unix)
    expect(result.command).not.toContain("{{SECRET:");
    expect(result.command).not.toContain("ghp_supersecret123");
    // Unix brace form or Windows %VAR%
    expect(result.command).toMatch(/(\$\{_SC_\d+\}|%_SC_\d+%)/);

    // Env map contains the value under a generated var name
    const [varName, varValue] = Object.entries(result.env)[0];
    expect(varName).toMatch(/^_SC_\d+$/);
    expect(varValue).toBe("ghp_supersecret123");

    // Key name logged, not value
    expect(result.keys).toContain("my-app/github-token");
  });

  it("resolves multiple different placeholders", async () => {
    const store = new Map([
      ["my-app/github-token", "ghp_supersecret123"],
      ["my-app/npm-token", "npm_topsecretabc"],
    ]);
    const backend = createMockBackend(store);

    const { injectSecrets } = await import("./inject.ts");
    const result = await injectSecrets(
      "TOKEN={{SECRET:my-app/github-token}} NPM={{SECRET:my-app/npm-token}} deploy",
      backend,
    );

    expect(result.command).not.toContain("{{SECRET:");
    expect(Object.keys(result.env)).toHaveLength(2);
    expect(result.keys).toContain("my-app/github-token");
    expect(result.keys).toContain("my-app/npm-token");
  });

  it("deduplicates the same placeholder appearing twice", async () => {
    const store = new Map([["project/api-key", "apikey_abcdefghij"]]);
    const backend = createMockBackend(store);

    const { injectSecrets } = await import("./inject.ts");
    const result = await injectSecrets(
      "A={{SECRET:project/api-key}} B={{SECRET:project/api-key}}",
      backend,
    );

    // Only one env var entry despite two occurrences
    expect(Object.keys(result.env)).toHaveLength(1);
    expect(result.keys).toHaveLength(1);
    // Both occurrences replaced in command
    expect(result.command).not.toContain("{{SECRET:");
  });

  it("returns the original command unchanged when no placeholders present", async () => {
    const backend = createMockBackend(new Map());

    const { injectSecrets } = await import("./inject.ts");
    const original = "echo hello world";
    const result = await injectSecrets(original, backend);

    expect(result.command).toBe(original);
    expect(result.env).toEqual({});
    expect(result.keys).toHaveLength(0);
  });

  it("throws SecretNotFoundError when key is missing from vault", async () => {
    const backend = createMockBackend(new Map()); // empty vault

    const { injectSecrets } = await import("./inject.ts");

    await expect(
      injectSecrets("cmd {{SECRET:missing/key}}", backend),
    ).rejects.toThrow(SecretNotFoundError);
  });

  it("does NOT mutate process.env", async () => {
    const store = new Map([["safe/env-test-key", "envtestvalue99"]]);
    const backend = createMockBackend(store);

    const { injectSecrets } = await import("./inject.ts");
    const before = { ...process.env };

    await injectSecrets("cmd {{SECRET:safe/env-test-key}}", backend);

    // process.env must be identical before and after
    expect(process.env).toEqual(before);
    // The secret value must not appear anywhere in the current env
    const envValues = Object.values(process.env).join("\n");
    expect(envValues).not.toContain("envtestvalue99");
  });

  it("returned command contains a shell var reference, not the raw value", async () => {
    const store = new Map([["proj/db-password", "hunter2_secure"]]);
    const backend = createMockBackend(store);

    const { injectSecrets } = await import("./inject.ts");
    const result = await injectSecrets(
      "psql --password={{SECRET:proj/db-password}}",
      backend,
    );

    // Command must not contain the raw secret value
    expect(result.command).not.toContain("hunter2_secure");
    // Command must use brace form on Unix (${ }) or %VAR% on Windows
    expect(result.command).toMatch(/(\$\{_SC_\d+\}|%_SC_\d+%)/);
  });

  it("keys that normalise to the same string do NOT collide — each gets a unique var", async () => {
    // "a-b" and "a_b" would both become _SC_A_B if derived from key name.
    // With indexed vars they must get distinct names and distinct values.
    const store = new Map([
      ["a-b", "secret_one_long"],
      ["a_b", "secret_two_long"],
    ]);
    const backend = createMockBackend(store);

    const { injectSecrets } = await import("./inject.ts");
    const result = await injectSecrets(
      "X={{SECRET:a-b}} Y={{SECRET:a_b}}",
      backend,
    );

    // Two distinct env vars must be present
    expect(Object.keys(result.env)).toHaveLength(2);
    const values = Object.values(result.env);
    expect(values).toContain("secret_one_long");
    expect(values).toContain("secret_two_long");

    // The two shell references in the command must be different
    const refs = [...result.command.matchAll(/(\$\{_SC_\d+\}|%_SC_\d+%)/g)].map(m => m[0]);
    expect(refs).toHaveLength(2);
    expect(refs[0]).not.toBe(refs[1]);
  });

  it("Unix shell ref uses brace form to avoid identifier-extension ambiguity", async () => {
    if (process.platform === "win32") return; // Windows uses %VAR% — different rule
    const store = new Map([["proj/key", "verylongsecret99"]]);
    const backend = createMockBackend(store);

    const { injectSecrets } = await import("./inject.ts");
    const result = await injectSecrets("cmd {{SECRET:proj/key}}extra", backend);

    // Must use ${VAR} not $VAR to avoid $VARextra being treated as the var name
    expect(result.command).toMatch(/\$\{_SC_\d+\}/);
    expect(result.command).not.toMatch(/\$_SC_\d+[^}]/);
  });
});
