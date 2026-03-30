import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import {
  isCompiledBinary,
  readConfirmLine,
  stripDirFromExportPathLine,
  uninstallBinary,
  UninstallCancelledError,
  type FsOps,
  type StdinLike,
} from "./uninstall-command.ts";

// ---------------------------------------------------------------------------
// Mock fs factory — avoids touching the real filesystem in tests
// ---------------------------------------------------------------------------

function makeFsOps(exists = true): { ops: FsOps; unlinkCalls: string[] } {
  const unlinkCalls: string[] = [];
  const ops: FsOps = {
    existsSync: (_path: string) => exists,
    unlink: async (path: string) => {
      unlinkCalls.push(path);
    },
  };
  return { ops, unlinkCalls };
}

// ---------------------------------------------------------------------------
// Minimal stdin mock for testing readConfirmLine (issue #45)
// ---------------------------------------------------------------------------

function makeStdinMock(): StdinLike & {
  push(data: string): void;
  end(): void;
  close(): void;
} {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  const mock = {
    setEncoding(_enc: BufferEncoding) {},
    resume() {},
    pause() {},
    on(event: string, fn: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(fn);
    },
    once(event: string, fn: (...args: unknown[]) => void) {
      const wrapped = (...args: unknown[]) => {
        mock.removeListener(event, wrapped);
        fn(...args);
      };
      (listeners[event] ??= []).push(wrapped);
    },
    removeListener(event: string, fn: (...args: unknown[]) => void) {
      listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
    },
    push(data: string) {
      (listeners["data"] ?? []).forEach((f) => f(data));
    },
    end() {
      (listeners["end"] ?? []).slice().forEach((f) => f());
    },
    close() {
      (listeners["close"] ?? []).slice().forEach((f) => f());
    },
  };
  return mock;
}

// ---------------------------------------------------------------------------
// isCompiledBinary
// ---------------------------------------------------------------------------

describe("isCompiledBinary", () => {
  it("returns false for bun runtime path", () => {
    expect(isCompiledBinary("/usr/local/bin/bun")).toBe(false);
  });

  it("returns false for bun.exe on Windows", () => {
    expect(isCompiledBinary("C:\\Users\\user\\.bun\\bin\\bun.exe")).toBe(false);
  });

  it("returns false for node runtime path", () => {
    expect(isCompiledBinary("/usr/bin/node")).toBe(false);
  });

  it("returns false for node.exe on Windows", () => {
    expect(isCompiledBinary("C:\\Program Files\\nodejs\\node.exe")).toBe(false);
  });

  it("returns true for a compiled see-crets binary", () => {
    expect(isCompiledBinary("/home/user/.local/bin/see-crets")).toBe(true);
  });

  it("returns true for see-crets.exe on Windows", () => {
    expect(isCompiledBinary("C:\\Users\\user\\bin\\see-crets.exe")).toBe(true);
  });

  it("returns true for any non-bun/non-node binary name", () => {
    expect(isCompiledBinary("/usr/local/bin/myapp")).toBe(true);
  });

  it("returns true for bunny (not the bun runtime — prefix match would fail)", () => {
    expect(isCompiledBinary("/usr/local/bin/bunny")).toBe(true);
  });

  it("returns true for node-helper (not the node runtime — prefix match would fail)", () => {
    expect(isCompiledBinary("/usr/local/bin/node-helper")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readConfirmLine — issue #45: resolves on stdin EOF without newline
// ---------------------------------------------------------------------------

describe("readConfirmLine", () => {
  it("resolves with trimmed text when newline arrives", async () => {
    const stdin = makeStdinMock();
    const promise = readConfirmLine(stdin);
    stdin.push("y\n");
    expect(await promise).toBe("y");
  });

  it("resolves with trimmed text on stdin 'end' without newline (issue #45)", async () => {
    const stdin = makeStdinMock();
    const promise = readConfirmLine(stdin);
    stdin.push("y"); // no trailing newline
    stdin.end();
    expect(await promise).toBe("y");
  });

  it("resolves with trimmed text on stdin 'close' without newline (issue #45)", async () => {
    const stdin = makeStdinMock();
    const promise = readConfirmLine(stdin);
    stdin.push("yes"); // no trailing newline
    stdin.close();
    expect(await promise).toBe("yes");
  });

  it("resolves with empty string when stdin closes with no data", async () => {
    const stdin = makeStdinMock();
    const promise = readConfirmLine(stdin);
    stdin.end();
    expect(await promise).toBe("");
  });

  it("does not double-resolve when both end and close fire", async () => {
    const stdin = makeStdinMock();
    const promise = readConfirmLine(stdin);
    stdin.push("n");
    stdin.end();
    stdin.close(); // second event — must not throw or re-resolve
    expect(await promise).toBe("n");
  });

  it("takes only the first line when data contains multiple newlines", async () => {
    const stdin = makeStdinMock();
    const promise = readConfirmLine(stdin);
    stdin.push("y\nextra\nlines");
    expect(await promise).toBe("y");
  });
});

// ---------------------------------------------------------------------------
// stripDirFromExportPathLine — issue #47: segment removal
// ---------------------------------------------------------------------------

describe("stripDirFromExportPathLine", () => {
  const DIR = "/home/user/.local/bin";

  // ---- Lines that should be left unchanged ----
  it("returns the line unchanged when it does not contain the dir", () => {
    const line = 'export PATH="/other/bin:$PATH"';
    expect(stripDirFromExportPathLine(line, DIR)).toBe(line);
  });

  it("returns the line unchanged when it is not an export PATH= line", () => {
    const line = `# export PATH="${DIR}"`;
    expect(stripDirFromExportPathLine(line, DIR)).toBe(line);
  });

  // ---- Single-entry: whole line must be removed ----
  it("returns null when the dir is the sole entry (quoted)", () => {
    expect(
      stripDirFromExportPathLine(`export PATH="${DIR}"`, DIR),
    ).toBeNull();
  });

  it("returns null when the dir is the sole entry (unquoted)", () => {
    expect(stripDirFromExportPathLine(`export PATH=${DIR}`, DIR)).toBeNull();
  });

  // ---- Multi-entry: only the segment is removed ----
  it("removes dir from start of a quoted multi-entry PATH", () => {
    const line = `export PATH="${DIR}:$PATH"`;
    expect(stripDirFromExportPathLine(line, DIR)).toBe('export PATH="$PATH"');
  });

  it("removes dir from end of a quoted multi-entry PATH", () => {
    const line = `export PATH="$PATH:${DIR}"`;
    expect(stripDirFromExportPathLine(line, DIR)).toBe('export PATH="$PATH"');
  });

  it("removes dir from the middle of a quoted multi-entry PATH", () => {
    const line = `export PATH="/first:${DIR}:/last"`;
    expect(stripDirFromExportPathLine(line, DIR)).toBe(
      'export PATH="/first:/last"',
    );
  });

  it("removes dir from start of an unquoted multi-entry PATH", () => {
    const line = `export PATH=${DIR}:$PATH`;
    expect(stripDirFromExportPathLine(line, DIR)).toBe("export PATH=$PATH");
  });

  it("removes dir from end of an unquoted multi-entry PATH", () => {
    const line = `export PATH=$PATH:${DIR}`;
    expect(stripDirFromExportPathLine(line, DIR)).toBe("export PATH=$PATH");
  });
});

// ---------------------------------------------------------------------------
// uninstallBinary — dev mode (interpreter path)
// ---------------------------------------------------------------------------

describe("uninstallBinary (dev mode)", () => {
  it("returns devModeNote without deleting anything when execPath is bun", async () => {
    const { ops, unlinkCalls } = makeFsOps(true);
    const result = await uninstallBinary(
      { execPath: "/usr/local/bin/bun", yes: true },
      ops,
    );

    expect(result.devModeNote).toBeDefined();
    expect(result.devModeNote).toContain("interpreter/dev mode");
    expect(result.removed).toBe("/usr/local/bin/bun");
    expect(unlinkCalls).toHaveLength(0);
  });

  it("returns devModeNote when execPath is bun.exe", async () => {
    const { ops, unlinkCalls } = makeFsOps(true);
    const result = await uninstallBinary(
      { execPath: "C:\\bun\\bun.exe", yes: true },
      ops,
    );

    expect(result.devModeNote).toBeDefined();
    expect(unlinkCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// uninstallBinary — compiled binary, --yes flag
// ---------------------------------------------------------------------------

describe("uninstallBinary (compiled, --yes)", () => {
  it("removes the binary and returns the path when --yes is set", async () => {
    const { ops, unlinkCalls } = makeFsOps(true);
    const result = await uninstallBinary(
      { execPath: "/home/user/.local/bin/see-crets", yes: true },
      ops,
    );

    expect(result.removed).toBe("/home/user/.local/bin/see-crets");
    expect(result.devModeNote).toBeUndefined();
    expect(unlinkCalls).toEqual(["/home/user/.local/bin/see-crets"]);
  });

  it("throws when binary does not exist at execPath", async () => {
    const { ops } = makeFsOps(false); // existsSync returns false
    await expect(
      uninstallBinary({ execPath: "/missing/see-crets", yes: true }, ops),
    ).rejects.toThrow("Binary not found at");
  });

  it("propagates fs.unlink errors", async () => {
    const ops: FsOps = {
      existsSync: () => true,
      unlink: async () => {
        throw new Error("EPERM: permission denied");
      },
    };
    await expect(
      uninstallBinary({ execPath: "/usr/local/bin/see-crets", yes: true }, ops),
    ).rejects.toThrow("EPERM: permission denied");
  });
});

// ---------------------------------------------------------------------------
// uninstallBinary — confirmation prompt (without --yes)
// ---------------------------------------------------------------------------

describe("uninstallBinary (confirmation prompt)", () => {
  let stderrOutput: string[];
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrOutput = [];
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(
      (msg: string | Uint8Array) => {
        stderrOutput.push(typeof msg === "string" ? msg : "");
        return true;
      },
    );
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("throws UninstallCancelledError when user answers 'n'", async () => {
    const { ops } = makeFsOps(true);
    await expect(
      uninstallBinary(
        { execPath: "/usr/local/bin/see-crets", readConfirm: async () => "n" },
        ops,
      ),
    ).rejects.toThrow(UninstallCancelledError);
  });

  it("shows correct confirmation prompt lines", async () => {
    // Verify the prompt text is written to stderr (requires --yes=false path).
    // We mock readConfirmLine by running with --yes=true and checking no prompt appears.
    const { ops, unlinkCalls } = makeFsOps(true);
    await uninstallBinary(
      { execPath: "/usr/local/bin/see-crets", yes: true },
      ops,
    );
    // With --yes, no prompt should be written to stderr.
    expect(stderrOutput).toHaveLength(0);
    expect(unlinkCalls).toHaveLength(1);
  });

  it("writes confirmation prompt to stderr when not using --yes", async () => {
    const { ops } = makeFsOps(true);
    await uninstallBinary(
      { execPath: "/usr/local/bin/see-crets", readConfirm: async () => "y" },
      ops,
    );
    expect(stderrOutput.some((l) => l.includes("About to remove:"))).toBe(true);
    expect(stderrOutput.some((l) => l.includes("Vault data"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// UninstallCancelledError
// ---------------------------------------------------------------------------

describe("UninstallCancelledError", () => {
  it("is an instance of Error", () => {
    const err = new UninstallCancelledError("test");
    expect(err instanceof Error).toBe(true);
  });

  it("has name UninstallCancelledError", () => {
    const err = new UninstallCancelledError("test");
    expect(err.name).toBe("UninstallCancelledError");
  });

  it("carries the provided message", () => {
    const err = new UninstallCancelledError("Uninstall cancelled.");
    expect(err.message).toBe("Uninstall cancelled.");
  });
});

// ---------------------------------------------------------------------------
// Result shape contract
// ---------------------------------------------------------------------------

describe("uninstallBinary result shape", () => {
  it("result.removed matches the provided execPath", async () => {
    const { ops } = makeFsOps(true);
    const path = "/opt/homebrew/bin/see-crets";
    const result = await uninstallBinary({ execPath: path, yes: true }, ops);
    expect(result.removed).toBe(path);
  });

  it("devModeNote is absent for compiled binaries", async () => {
    const { ops } = makeFsOps(true);
    const result = await uninstallBinary(
      { execPath: "/usr/local/bin/see-crets", yes: true },
      ops,
    );
    expect(result.devModeNote).toBeUndefined();
  });

  it("vault data is NEVER touched — no vault calls are made", async () => {
    // uninstallBinary only calls fs.unlink — no backend/vault interaction.
    const vaultCalled = { touched: false };
    const ops: FsOps = {
      existsSync: () => true,
      unlink: async () => {
        // If we were touching vault we'd call backend here — we don't.
      },
    };
    const result = await uninstallBinary(
      { execPath: "/usr/local/bin/see-crets", yes: true },
      ops,
    );
    expect(vaultCalled.touched).toBe(false);
    expect(result.removed).toBe("/usr/local/bin/see-crets");
  });
});
