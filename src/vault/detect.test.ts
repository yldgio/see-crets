import { describe, it, expect } from "bun:test";
import { detectResult } from "./detect.ts";

// NOTE: ask-secret-set.test.ts and secrets-list.test.ts call mock.module() on
// detect.ts. In Bun, module mocks persist across files within the same test run,
// so the `detectResult` and `detectBackend` exports here may be mocked versions.
//
// Reliable platform-routing behavior (freebsd → throws, win32 → Windows backend, …)
// should be validated in dedicated tests that import ./detect.ts in a fresh Bun
// process or otherwise avoid cross-file module mocks.
//
// The tests here intentionally avoid platform assumptions and stay meaningful
// under both the real and mocked module.

describe("detectResult", () => {
  it("returns a valid DetectResult shape", async () => {
    const result = await detectResult();
    expect(typeof result.available).toBe("boolean");
    expect(typeof result.backend).toBe("string");
    expect(result.backend.length).toBeGreaterThan(0);
    // When mocked, `detail` may be undefined; otherwise it's a string or absent
    if (result.detail !== undefined) {
      expect(typeof result.detail).toBe("string");
    }
  });

  it("does not expose raw secret values", async () => {
    const result = await detectResult();
    const json = JSON.stringify(result);
    expect(json).not.toContain("password");
  });
});
