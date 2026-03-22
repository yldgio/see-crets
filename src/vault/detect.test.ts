import { describe, it, expect } from "bun:test";
import { detectResult } from "./detect.ts";

// NOTE: Other test files (secrets-list, ask-secret-set) mock `detect.ts` globally,
// which makes detectBackend() return a MockVault for any platform. These tests are
// written to work correctly regardless of whether the module is mocked or not.
// Platform-specific routing (win32 / darwin / linux / unsupported) is verified by the
// CI matrix which runs `bun test` on each real OS runner.

describe("detectResult", () => {
  it("returns a valid DetectResult shape", async () => {
    const result = await detectResult();
    expect(typeof result.available).toBe("boolean");
    expect(typeof result.backend).toBe("string");
    expect(result.backend.length).toBeGreaterThan(0);
  });

  it("returns available: true on the current platform", async () => {
    const result = await detectResult();
    expect(result.available).toBe(true);
  });

  it("does not include a raw secret value in the result", async () => {
    const result = await detectResult();
    // Sanity check: the DetectResult only exposes metadata, never a secret value
    const json = JSON.stringify(result);
    expect(json).not.toContain("password");
    expect(json).not.toContain("secret");
  });
});
