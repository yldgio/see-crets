import { describe, it, expect } from "bun:test";
import {
  BUILTIN_MAP,
  loadProjectConfig,
  resolveEnvMap,
  envVarForKey,
} from "./env-map.ts";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Helper: create a temp dir with a .see-crets.json containing `content`
// ---------------------------------------------------------------------------
function withConfigFile(content: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "see-crets-test-"));
  writeFileSync(join(dir, ".see-crets.json"), content, "utf8");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("BUILTIN_MAP", () => {
  it("contains the canonical github-token mapping", () => {
    expect(BUILTIN_MAP["github-token"]).toBe("GITHUB_TOKEN");
  });

  it("contains openai-api-key mapping", () => {
    expect(BUILTIN_MAP["openai-api-key"]).toBe("OPENAI_API_KEY");
  });

  it("contains anthropic-api-key mapping", () => {
    expect(BUILTIN_MAP["anthropic-api-key"]).toBe("ANTHROPIC_API_KEY");
  });

  it("has at least 15 entries", () => {
    expect(Object.keys(BUILTIN_MAP).length).toBeGreaterThanOrEqual(15);
  });
});

describe("loadProjectConfig", () => {
  it("returns empty object when .see-crets.json does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "see-crets-test-"));
    try {
      expect(loadProjectConfig(dir)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns the map from a valid .see-crets.json", () => {
    const { dir, cleanup } = withConfigFile(
      JSON.stringify({ map: { "my-custom-key": "MY_CUSTOM_VAR" } }),
    );
    try {
      expect(loadProjectConfig(dir)).toEqual({ "my-custom-key": "MY_CUSTOM_VAR" });
    } finally {
      cleanup();
    }
  });

  it("returns empty object when .see-crets.json has no map field", () => {
    const { dir, cleanup } = withConfigFile(JSON.stringify({}));
    try {
      expect(loadProjectConfig(dir)).toEqual({});
    } finally {
      cleanup();
    }
  });

  it("throws a descriptive error for invalid JSON", () => {
    const { dir, cleanup } = withConfigFile("not valid json {{{");
    try {
      expect(() => loadProjectConfig(dir)).toThrow(/not valid JSON/);
    } finally {
      cleanup();
    }
  });

  it("throws when root is not an object", () => {
    const { dir, cleanup } = withConfigFile(JSON.stringify([1, 2, 3]));
    try {
      expect(() => loadProjectConfig(dir)).toThrow(/must be a JSON object/);
    } finally {
      cleanup();
    }
  });

  it("throws when map field is not an object", () => {
    const { dir, cleanup } = withConfigFile(JSON.stringify({ map: "bad" }));
    try {
      expect(() => loadProjectConfig(dir)).toThrow(/"map" must be an object/);
    } finally {
      cleanup();
    }
  });

  it("throws when a map value is not a string", () => {
    const { dir, cleanup } = withConfigFile(
      JSON.stringify({ map: { "my-key": 42 } }),
    );
    try {
      expect(() => loadProjectConfig(dir)).toThrow(/must be a string/);
    } finally {
      cleanup();
    }
  });
});

describe("resolveEnvMap", () => {
  it("returns the built-in map when no projectDir given", () => {
    const map = resolveEnvMap();
    expect(map["github-token"]).toBe("GITHUB_TOKEN");
    expect(map["openai-api-key"]).toBe("OPENAI_API_KEY");
  });

  it("project override takes precedence over built-in for the same key", () => {
    const { dir, cleanup } = withConfigFile(
      JSON.stringify({ map: { "github-token": "GH_TOKEN_CUSTOM" } }),
    );
    try {
      const map = resolveEnvMap(dir);
      expect(map["github-token"]).toBe("GH_TOKEN_CUSTOM");
      // Other built-in entries still present
      expect(map["openai-api-key"]).toBe("OPENAI_API_KEY");
    } finally {
      cleanup();
    }
  });

  it("project-only keys are added on top of built-in map", () => {
    const { dir, cleanup } = withConfigFile(
      JSON.stringify({ map: { "my-custom-key": "MY_CUSTOM_VAR" } }),
    );
    try {
      const map = resolveEnvMap(dir);
      expect(map["my-custom-key"]).toBe("MY_CUSTOM_VAR");
      expect(map["github-token"]).toBe("GITHUB_TOKEN");
    } finally {
      cleanup();
    }
  });
});

describe("envVarForKey", () => {
  const map = BUILTIN_MAP;

  it("matches using the suffix after the last /", () => {
    expect(envVarForKey("my-app/github-token", map)).toBe("GITHUB_TOKEN");
  });

  it("matches a key with no namespace prefix", () => {
    expect(envVarForKey("github-token", map)).toBe("GITHUB_TOKEN");
  });

  it("returns undefined for an unknown key", () => {
    expect(envVarForKey("my-app/unknown-key-xyz", map)).toBeUndefined();
  });

  it("uses exact suffix match — partial suffix does not match", () => {
    // "token" alone should not match "github-token"
    expect(envVarForKey("my-app/token", map)).toBeUndefined();
  });

  it("does NOT return prototype properties for suffix like 'toString'", () => {
    expect(envVarForKey("my-app/toString", map)).toBeUndefined();
    expect(envVarForKey("my-app/constructor", map)).toBeUndefined();
    expect(envVarForKey("my-app/hasOwnProperty", map)).toBeUndefined();
  });
});
