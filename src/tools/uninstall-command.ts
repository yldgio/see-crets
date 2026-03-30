import { unlink } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UninstallOptions {
  /** Skip confirmation prompt (for --yes / CI use). */
  yes?: boolean;
  /**
   * Override the binary path to remove.
   * Defaults to `process.execPath`.
   * Injected in tests to avoid touching real paths.
   */
  execPath?: string;
  /**
   * Override the confirmation reader (injectable for tests).
   * Defaults to `readConfirmLine` which reads a line from stdin.
   */
  readConfirm?: () => Promise<string>;
}

export interface UninstallResult {
  /** Absolute path that was (or would be) removed. */
  removed: string;
  /**
   * Present only when running in interpreter/dev mode.
   * The binary was NOT actually deleted in this case.
   */
  devModeNote?: string;
}

/** Injected fs surface — makes the core logic unit-testable without mock.module. */
export interface FsOps {
  existsSync: (path: string) => boolean;
  unlink: (path: string) => Promise<void>;
}

const defaultFsOps: FsOps = { existsSync, unlink };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when running as a compiled binary.
 * Returns `false` when the process is the Bun (or Node) runtime itself,
 * i.e. in dev mode via `bun run src/cli.ts`.
 */
export function isCompiledBinary(execPath: string = process.execPath): boolean {
  const name = (execPath.split(/[/\\]/).pop() ?? execPath).toLowerCase();
  // Exact-match bun/node runtimes — prefix match would wrongly catch `bunny`, `node-helper`, etc.
  return name !== "bun" && name !== "bun.exe" && name !== "node" && name !== "node.exe";
}

/** Minimal interface for the stdin stream — allows injection in tests. */
export interface StdinLike {
  setEncoding(encoding: BufferEncoding): void;
  resume(): void;
  pause(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * Reads a single line from stdin for the confirmation prompt.
 * Returns the trimmed input string.
 *
 * Handles two resolution paths:
 *  1. A newline character arrives in the data stream (normal interactive use).
 *  2. stdin closes / ends without a newline (e.g. `echo -n "y" | see-crets uninstall`).
 *     In that case the accumulated buffer is resolved as-is so the process
 *     does not hang indefinitely (fix for issue #45).
 *
 * @param stdin - Defaults to `process.stdin`; inject a mock in tests.
 */
export async function readConfirmLine(
  stdin: StdinLike = process.stdin,
): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    let resolved = false;

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      stdin.removeListener("close", onEnd);
      stdin.pause();
    };

    const onData = (chunk: unknown) => {
      buf += chunk as string;
      const nlIdx = buf.indexOf("\n");
      if (nlIdx !== -1 && !resolved) {
        resolved = true;
        cleanup();
        resolve(buf.slice(0, nlIdx).trim());
      }
    };

    const onEnd = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(buf.trim());
      }
    };

    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
    stdin.once("end", onEnd);
    stdin.once("close", onEnd);
  });
}

// ---------------------------------------------------------------------------
// PATH cleanup helper — pure logic (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Strips `dir` from a single `export PATH=...` shell line.
 *
 * Returns the modified line, or `null` if the line should be deleted entirely
 * (i.e. `dir` was the only meaningful entry and nothing remains).
 * Returns the line unchanged if it is not an `export PATH=` line or
 * does not contain `dir`.
 *
 * Fix for issue #47: previously the whole line was deleted even when
 * other PATH entries (e.g. `:$PATH`) were present on the same line.
 */
export function stripDirFromExportPathLine(
  line: string,
  dir: string,
): string | null {
  if (!line.includes(dir) || !/^export PATH=/.test(line)) return line;

  const prefix = "export PATH=";
  let rest = line.slice(prefix.length);

  // Detect and strip optional surrounding quotes (matching pair only).
  let quote = "";
  if (
    (rest.startsWith('"') && rest.endsWith('"')) ||
    (rest.startsWith("'") && rest.endsWith("'"))
  ) {
    quote = rest[0];
    rest = rest.slice(1, -1);
  }

  // Split the PATH value on colons, remove our dir, drop empty segments.
  const parts = rest.split(":").filter((p) => p !== dir && p !== "");

  // Nothing left — delete the whole line.
  if (parts.length === 0) return null;

  return `${prefix}${quote}${parts.join(":")}${quote}`;
}

// ---------------------------------------------------------------------------
// Core logic (injectable deps — fully unit-testable)
// ---------------------------------------------------------------------------

/**
 * Removes the installed binary at `execPath` (defaults to `process.execPath`).
 *
 * Behaviour:
 * - Dev mode (running via Bun/Node interpreter): does NOT delete anything;
 *   returns a `devModeNote` explaining what path *would* be removed.
 * - Normal mode without `--yes`: prints confirmation prompt, aborts on anything
 *   other than `y`/`Y`.
 * - Normal mode with `--yes`: removes immediately, no prompt.
 *
 * Vault data (OS keychain) is NEVER touched.
 */
export async function uninstallBinary(
  options: UninstallOptions = {},
  fs: FsOps = defaultFsOps,
): Promise<UninstallResult> {
  const execPath = options.execPath ?? process.execPath;

  // Dev-mode guard — don't accidentally remove the Bun runtime.
  if (!isCompiledBinary(execPath)) {
    const note =
      `Running in interpreter/dev mode — execPath is the Bun or Node runtime interpreter, not an installed binary.\n` +
      `Path that would be removed if installed: ${execPath}\n` +
      `Re-run from the installed binary location to perform a real uninstall.`;
    return { removed: execPath, devModeNote: note };
  }

  if (!fs.existsSync(execPath)) {
    throw new Error(`Binary not found at: ${execPath}`);
  }

  if (!options.yes) {
    process.stderr.write(`About to remove: ${execPath}\n`);
    process.stderr.write("Vault data (OS keychain) will NOT be affected.\n");
    process.stderr.write("Remove? [y/N] ");
    const answer = await (options.readConfirm ?? readConfirmLine)();
    if (answer.toLowerCase() !== "y") {
      throw new UninstallCancelledError("Uninstall cancelled.");
    }
  }

  // Windows self-delete: a running .exe cannot unlink itself (file is locked).
  // Catch the OS error and give the user manual instructions rather than crashing.
  try {
    await fs.unlink(execPath);
  } catch (err) {
    if (
      process.platform === "win32" &&
      err instanceof Error &&
      ["EPERM", "EBUSY", "EACCES"].includes(
        ((err as NodeJS.ErrnoException).code) ?? "",
      )
    ) {
      process.stderr.write(
        `Cannot delete the binary while it is running on Windows.\n`,
      );
      process.stderr.write(`Please delete manually: ${execPath}\n`);
      process.stderr.write(`Or run: del "${execPath}"\n`);
      return { removed: execPath };
    }
    throw err;
  }

  return { removed: execPath };
}

export class UninstallCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UninstallCancelledError";
  }
}

// ---------------------------------------------------------------------------
// PATH cleanup helper (best-effort — called by CLI with --yes)
// ---------------------------------------------------------------------------

/**
 * Attempts to remove the install directory from the user's PATH.
 *
 * - **Unix**: Scans common shell rc files and strips the matching `export PATH=…` line.
 * - **Windows**: Returns the PowerShell command the user should run manually
 *   (modifying the registry PATH programmatically is risky and requires elevation).
 *
 * Always returns a human-readable status string.
 */
async function tryRemoveFromPath(dir: string): Promise<string> {
  if (process.platform === "win32") {
    return (
      `Run in PowerShell to remove from PATH:\n` +
      `  [Environment]::SetEnvironmentVariable('PATH', ($env:PATH -replace [Regex]::Escape('${dir};'), ''), 'User')`
    );
  }

  const rcFiles = [".bashrc", ".zshrc", ".profile", ".bash_profile"]
    .map((f) => join(homedir(), f))
    .filter((f) => existsSync(f));

  let removed = false;
  for (const rcFile of rcFiles) {
    const content = readFileSync(rcFile, "utf8");
    if (!content.includes(dir)) continue;

    const lines = content.split("\n");
    let changed = false;
    const newLines = lines
      .map((line) => {
        const result = stripDirFromExportPathLine(line, dir);
        if (result !== line) changed = true;
        return result;
      })
      .filter((l): l is string => l !== null);

    if (changed) {
      writeFileSync(rcFile, newLines.join("\n"));
      removed = true;
    }
  }

  return removed
    ? `Removed PATH entry from shell config(s).`
    : `PATH entry not found in shell config files — remove manually if needed.`;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * CLI handler for `see-crets uninstall`.
 *
 * Flags:
 *   --yes   Skip confirmation prompt (scripted / CI use).
 */
export async function runUninstallCommand(): Promise<void> {
  const args = process.argv.slice(2);
  const yes = args.includes("--yes");

  try {
    const result = await uninstallBinary({ yes });

    if (result.devModeNote) {
      // Dev mode — nothing was deleted.
      process.stdout.write(`[dev mode] ${result.devModeNote}\n`);
      return;
    }

    const installDir = dirname(result.removed);
    process.stdout.write(`Removed: ${result.removed}\n`);
    process.stdout.write(`\nVault data (OS keychain) has NOT been touched.\n`);

    if (yes) {
      // --yes: attempt PATH cleanup automatically, report what was done.
      const pathResult = await tryRemoveFromPath(installDir);
      process.stdout.write(`${pathResult}\n`);
    } else {
      // Interactive mode: user confirmed deletion — print manual instructions.
      process.stdout.write(
        `To complete removal, remove '${installDir}' from your PATH if it was added for see-crets.\n`,
      );
    }
  } catch (err) {
    if (err instanceof UninstallCancelledError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}
