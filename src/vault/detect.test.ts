import { describe, it, expect } from "bun:test";
import { detectResult } from "./detect.ts";

// NOTE: ask-secret-set.test.ts and secrets-list.test.ts call mock.module() on
// detect.ts. In Bun, module mocks persist across files within the same test run,
// so the `detectResult` and `detectBackend` exports here may be mocked versions.
//
// Reliable platform-routing tests (freebsd → throws, win32 → Windows backend, …)
// are covered by the CI matrix which runs `bun test` on isolated win/ubuntu/macos
// runners where no other test file has mocked detect.ts.
//
// The tests here stay meaningful under both the real and mocked module.

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
