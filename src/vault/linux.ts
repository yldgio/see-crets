/**
 * Linux vault backend.
 *
 * Fallback chain: libsecret (secret-tool) -> pass (GPG store) -> hard error
 *
 * The active tool is probed once at first use and cached for the lifetime of
 * the process.  The probe is injectable for unit testing (resolveBackend
 * accepts a `probe` function) so the fallback logic can be verified on any OS
 * without real Linux tools installed.
 *
 * Secret values are always passed via stdin, never on the command line.
 */
import { homedir } from "os";
import type { VaultBackend } from "./types.ts";

export type LinuxTool = "libsecret" | "pass";

/** Default probe: returns true when the given command is available */
function defaultProbe(cmd: string): boolean {
  try {
    const r = Bun.spawnSync([cmd, "--version"], { env: process.env });
    return (r.exitCode ?? -1) === 0;
  } catch {
    return false;
  }
}

const TARGET_PREFIX = "see-crets:";

function shRun(
  args: string[],
  opts?: { env?: Record<string, string>; stdin?: Buffer }
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = Bun.spawnSync(args, {
      env: opts?.env ? { ...process.env, ...opts.env } : process.env,
      stdin: opts?.stdin ?? undefined,
    });
    return {
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
      exitCode: result.exitCode ?? -1,
    };
  } catch {
    return { stdout: "", stderr: "", exitCode: -1 };
  }
}

/** Shared key validation applied by set(), get(), and delete() */
function validateKey(key: string): void {
  if (/[\r\n]/.test(key)) {
    throw new Error(`Invalid key '${key}': key must not contain newlines`);
  }
  if (key !== key.trim()) {
    throw new Error(
      `Invalid key '${key}': key must not have leading or trailing whitespace`
    );
  }
  if (key.split("/").some((seg) => seg === ".." || seg === ".")) {
    throw new Error(
      `Invalid key '${key}': key must not contain path traversal segments`
    );
  }
}

export class LinuxVaultBackend implements VaultBackend {
  readonly name = "Linux Secret Store";

  private _resolvedTool: LinuxTool | null = null;

  /**
   * Probe which tool is available. `probe` is injectable for unit tests.
   * Caches the result after first successful resolution.
   */
  async resolveBackend(
    probe: (cmd: string) => boolean = defaultProbe
  ): Promise<LinuxTool> {
    if (this._resolvedTool) return this._resolvedTool;

    if (probe("secret-tool")) {
      this._resolvedTool = "libsecret";
      return "libsecret";
    }
    if (probe("pass")) {
      this._resolvedTool = "pass";
      return "pass";
    }
    throw new Error(
      "No vault backend available. Install libsecret-tools (secret-tool) or pass."
    );
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.resolveBackend();
      return true;
    } catch {
      return false;
    }
  }

  async set(key: string, value: string): Promise<void> {
    validateKey(key);
    const tool = await this.resolveBackend();
    if (tool === "libsecret") {
      await this._libsecretSet(key, value);
    } else {
      await this._passSet(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    validateKey(key);
    const tool = await this.resolveBackend();
    return tool === "libsecret"
      ? this._libsecretGet(key)
      : this._passGet(key);
  }

  async delete(key: string): Promise<void> {
    validateKey(key);
    const tool = await this.resolveBackend();
    if (tool === "libsecret") {
      await this._libsecretDelete(key);
    } else {
      await this._passDelete(key);
    }
  }

  async list(prefix: string): Promise<string[]> {
    if (/[*?]/.test(prefix)) {
      throw new Error(
        `list() prefix must not contain wildcard characters: "${prefix}"`
      );
    }
    if (prefix.split("/").some((seg) => seg === ".." || seg === ".")) {
      throw new Error(
        `list() prefix must not contain path traversal segments: "${prefix}"`
      );
    }
    const tool = await this.resolveBackend();
    return tool === "libsecret"
      ? this._libsecretList(prefix)
      : this._passList(prefix);
  }

  // ---------------------------------------------------------------------------
  // libsecret (secret-tool) implementation
  // ---------------------------------------------------------------------------

  private async _libsecretSet(key: string, value: string): Promise<void> {
    const r = shRun(
      [
        "secret-tool",
        "store",
        "--label",
        `${TARGET_PREFIX}${key}`,
        "service",
        "see-crets",
        "account",
        key,
      ],
      { stdin: Buffer.from(value) }
    );
    if (r.exitCode !== 0) {
      throw new Error(
        `Failed to store credential '${key}': ${r.stderr.trim()}`
      );
    }
  }

  private async _libsecretGet(key: string): Promise<string | null> {
    const r = shRun([
      "secret-tool",
      "lookup",
      "service",
      "see-crets",
      "account",
      key,
    ]);
    if (r.exitCode !== 0 || r.stdout === "") return null;
    return r.stdout.replace(/\r?\n$/, "");
  }

  private async _libsecretDelete(key: string): Promise<void> {
    const r = shRun(["secret-tool", "clear", "service", "see-crets", "account", key]);
    // secret-tool clear exits 0 even when the item does not exist -- only throw on
    // unexpected non-zero exit codes (e.g., D-Bus unavailable, permission denied).
    if (r.exitCode !== 0) {
      throw new Error(
        `Failed to delete credential '${key}': ${r.stderr.trim()}`
      );
    }
  }

  private async _libsecretList(prefix: string): Promise<string[]> {
    const r = shRun([
      "secret-tool",
      "search",
      "--all",
      "service",
      "see-crets",
    ]);
    if (r.exitCode !== 0) return [];

    const results: string[] = [];
    // Output block format per item:
    //   [/org/freedesktop/secrets/collection/login/N]
    //   label = see-crets:my-project/github-token
    //   account = my-project/github-token
    //   service = see-crets
    const accountRegex = /^account = (.+)$/m;
    const blocks = r.stdout.split(/\[\/org\//);
    for (const block of blocks) {
      const m = accountRegex.exec(block);
      if (m && m[1].startsWith(prefix)) {
        results.push(m[1]);
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // pass (GPG store) implementation
  // ---------------------------------------------------------------------------

  private _passKey(key: string): string {
    return `see-crets/${key}`;
  }

  private async _passSet(key: string, value: string): Promise<void> {
    // -m (multiline): reads all stdin as the password, preserving any newlines
    // in the value. -f: skip confirmation prompt.
    const r = shRun(["pass", "insert", "-m", "-f", this._passKey(key)], {
      stdin: Buffer.from(value),
    });
    if (r.exitCode !== 0) {
      throw new Error(
        `Failed to store credential '${key}': ${r.stderr.trim()}`
      );
    }
  }

  private async _passGet(key: string): Promise<string | null> {
    const r = shRun(["pass", "show", this._passKey(key)]);
    if (r.exitCode !== 0) return null;
    return r.stdout.replace(/\r?\n$/, "");
  }

  private async _passDelete(key: string): Promise<void> {
    const r = shRun(["pass", "rm", "-f", this._passKey(key)]);
    // pass rm -f exits 0 when the entry does not exist -- only throw on
    // unexpected failures (permission, GPG errors, etc.).
    if (r.exitCode !== 0) {
      throw new Error(
        `Failed to delete credential '${key}': ${r.stderr.trim()}`
      );
    }
  }

  private async _passList(prefix: string): Promise<string[]> {
    // homedir() is used instead of process.env.HOME because "~" is NOT
    // expanded by `find` when passed directly as a path argument.
    const storeDir =
      process.env.PASSWORD_STORE_DIR ?? `${homedir()}/.password-store`;
    const searchDir = `${storeDir}/see-crets/${prefix}`;

    const r = shRun(["find", "--", searchDir, "-name", "*.gpg", "-type", "f"]);
    if (r.exitCode !== 0) return [];

    const basePath = `${storeDir}/see-crets/`;
    return r.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((p) => p.slice(basePath.length).replace(/\.gpg$/, ""));
  }
}
