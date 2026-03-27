import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

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
  // Bun ships as `bun` / `bun.exe`; Node as `node` / `node.exe`.
  return !name.startsWith("bun") && !name.startsWith("node");
}

/**
 * Reads a single line from stdin for the confirmation prompt.
 * Returns the trimmed input string.
 */
export async function readConfirmLine(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk: string) => {
      buf += chunk;
      const nlIdx = buf.indexOf("\n");
      if (nlIdx !== -1) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        resolve(buf.slice(0, nlIdx).trim());
      }
    };
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
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
      `Running in interpreter/dev mode — execPath is the Bun runtime, not an installed binary.\n` +
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
    const answer = await readConfirmLine();
    if (answer.toLowerCase() !== "y") {
      throw new UninstallCancelledError("Uninstall cancelled.");
    }
  }

  await fs.unlink(execPath);

  return { removed: execPath };
}

export class UninstallCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UninstallCancelledError";
  }
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
    process.stdout.write(
      `To complete removal, remove '${installDir}' from your PATH if it was added for see-crets.\n`,
    );
  } catch (err) {
    if (err instanceof UninstallCancelledError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}
