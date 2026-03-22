/**
 * macOS Keychain vault backend.
 *
 * Storage attributes:
 *   Service name: `see-crets:NAMESPACE/KEY`  (e.g. `see-crets:my-project/github-token`)
 *   Account name: `see-crets` (constant sentinel)
 *
 * The secret value is always passed via the SC_VAL environment variable and
 * piped to `security add-generic-password` via stdin so it never appears in
 * process command-line arguments.
 */
import type { VaultBackend } from "./types.ts";

const TARGET_PREFIX = "see-crets:";
const ACCOUNT = "see-crets";

function shRun(
  args: string[],
  opts?: { env?: Record<string, string>; stdin?: Buffer }
): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(args, {
    env: opts?.env ? { ...process.env, ...opts.env } : process.env,
    stdin: opts?.stdin ?? undefined,
  });
  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    exitCode: result.exitCode ?? -1,
  };
}

/** Escape a string for safe embedding inside a shell single-quoted argument */
function shEscape(s: string): string {
  // Single-quote wrapping: replace each ' with '\''
  return s.replace(/'/g, "'\\''");
}

export class MacosVaultBackend implements VaultBackend {
  readonly name = "macOS Keychain";

  async isAvailable(): Promise<boolean> {
    const r = shRun(["security", "list-keychains"]);
    return r.exitCode === 0;
  }

  async set(key: string, value: string): Promise<void> {
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

    const service = `${TARGET_PREFIX}${key}`;
    // Use `security -i` so the value is passed via stdin to the security process.
    // This keeps the secret out of every process's argv (not visible in `ps aux`).
    // -U: update existing entry if present (upsert semantics).
    const cmd =
      `add-generic-password` +
      ` -s '${shEscape(service)}'` +
      ` -a '${shEscape(ACCOUNT)}'` +
      ` -w '${shEscape(value)}'` +
      ` -U\nquit\n`;
    const r = shRun(["security", "-i"], { stdin: Buffer.from(cmd) });
    if (r.exitCode !== 0) {
      throw new Error(
        `Failed to store credential '${key}': ${r.stderr.trim()}`
      );
    }
  }

  async get(key: string): Promise<string | null> {
    const service = `${TARGET_PREFIX}${key}`;
    const r = shRun([
      "security",
      "find-generic-password",
      "-s",
      service,
      "-a",
      ACCOUNT,
      "-w",
    ]);
    if (r.exitCode !== 0) return null;
    // Strip only the single trailing newline added by `security`
    return r.stdout.replace(/\r?\n$/, "");
  }

  async delete(key: string): Promise<void> {
    const service = `${TARGET_PREFIX}${key}`;
    const r = shRun([
      "security",
      "delete-generic-password",
      "-s",
      service,
      "-a",
      ACCOUNT,
    ]);
    // Exit code 44 = item not found — treat as no-op, same as Windows backend
    if (r.exitCode !== 0 && r.exitCode !== 44) {
      throw new Error(
        `Failed to delete credential '${key}': ${r.stderr.trim()}`
      );
    }
  }

  async list(prefix: string): Promise<string[]> {
    if (/[*?]/.test(prefix)) {
      throw new Error(
        `list() prefix must not contain wildcard characters: "${prefix}"`
      );
    }

    // dump-keychain outputs all entries; we parse service-name blobs.
    const r = shRun(["security", "dump-keychain"]);
    if (r.exitCode !== 0) return [];

    const fullPrefix = `${TARGET_PREFIX}${prefix}`;
    const results: string[] = [];

    // Each keychain entry has a line like:
    //   "svce"<blob>="see-crets:my-project/github-token"
    const regex = /"svce"<blob>="([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(r.stdout)) !== null) {
      const service = match[1];
      if (service.startsWith(fullPrefix)) {
        results.push(service.slice(TARGET_PREFIX.length));
      }
    }
    return results;
  }
}
