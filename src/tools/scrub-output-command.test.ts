import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import type { VaultBackend } from "../vault/types.ts";

// ---------------------------------------------------------------------------
// Shared broken-backend factory — throws on all vault operations.
// Using a directly-injected backend avoids mock.module() calls, which in Bun
// persist across files and can contaminate later tests.
// ---------------------------------------------------------------------------

function createBrokenBackend(): VaultBackend {
  return {
    name: "BrokenVault",
    async isAvailable() {
      return false;
    },
    async set() {},
    async get() {
      throw new Error("vault unavailable");
    },
    async delete() {},
    async list() {
      throw new Error("vault unavailable");
    },
  };
}

// ---------------------------------------------------------------------------
// scrubOutput() — now throws on vault error (fail-closed; callers decide policy)
// ---------------------------------------------------------------------------

describe("scrubOutput", () => {
  it("throws when a directly-injected backend is broken", async () => {
    const { scrubOutput } = await import("./scrub-output-command.ts");
    const broken = createBrokenBackend();
    await expect(scrubOutput("tool output with data", broken)).rejects.toThrow(
      "vault unavailable",
    );
  });
});

// ---------------------------------------------------------------------------
// runScrubOutputCommand() — fail-closed default; --fail-open explicit opt-in
//
// The backend is injected directly (no mock.module) so these tests are
// order-independent and safe to run in any test suite configuration.
// ---------------------------------------------------------------------------

describe("runScrubOutputCommand", () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = [...process.argv];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("vault error → writes suppression message to stdout (fail-closed default)", async () => {
    const rawInput = "tool output containing secret_value_12345678";
    const stdinSpy = spyOn(Bun.stdin, "text").mockResolvedValue(rawInput);
    let captured = "";
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(
      ((chunk: string | Uint8Array) => {
        captured +=
          typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
        return true;
      }) as typeof process.stdout.write,
    );

    process.argv = ["bun", "scrub-output"]; // no --fail-open

    try {
      const { runScrubOutputCommand } = await import("./scrub-output-command.ts");
      await runScrubOutputCommand(createBrokenBackend());

      // Fail-closed: raw input must NOT appear; suppression message MUST appear
      expect(captured).not.toContain("secret_value_12345678");
      expect(captured).toContain("[OUTPUT SUPPRESSED");
    } finally {
      stdinSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });

  it("--fail-open + vault error → writes raw input to stdout", async () => {
    const rawInput = "tool output containing secret_value_12345678";
    const stdinSpy = spyOn(Bun.stdin, "text").mockResolvedValue(rawInput);
    let captured = "";
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(
      ((chunk: string | Uint8Array) => {
        captured +=
          typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
        return true;
      }) as typeof process.stdout.write,
    );

    process.argv = ["bun", "scrub-output", "--fail-open"];

    try {
      const { runScrubOutputCommand } = await import("./scrub-output-command.ts");
      await runScrubOutputCommand(createBrokenBackend());

      // Fail-open: raw input passes through unchanged
      expect(captured).toBe(rawInput);
    } finally {
      stdinSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });

  it("suppression message matches the exported OUTPUT_SUPPRESSED_MSG constant", async () => {
    const stdinSpy = spyOn(Bun.stdin, "text").mockResolvedValue("any input");
    let captured = "";
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(
      ((chunk: string | Uint8Array) => {
        captured +=
          typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
        return true;
      }) as typeof process.stdout.write,
    );

    process.argv = ["bun", "scrub-output"];

    try {
      const { runScrubOutputCommand, OUTPUT_SUPPRESSED_MSG } = await import(
        "./scrub-output-command.ts"
      );
      await runScrubOutputCommand(createBrokenBackend());

      expect(captured).toBe(OUTPUT_SUPPRESSED_MSG);
    } finally {
      stdinSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });
});

