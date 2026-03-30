/**
 * macOS Keychain vault backend.
 *
 * Storage attributes:
 *   Service name: `see-crets:NAMESPACE/KEY`  (e.g. `see-crets:my-project/github-token`)
 *   Account name: `see-crets` (constant sentinel)
 *
 * The secret value is passed to `security -i` via stdin as part of an
 * interactive command, so it never appears in any process argv (not visible
 * in `ps aux`). The -i flag makes security read commands line-by-line from
 * stdin; values containing newlines would break the command stream and are
 * therefore rejected.
 */
import type { VaultBackend } from "./types.ts";

const TARGET_PREFIX = "see-crets:";
const ACCOUNT = "see-crets";

/** Minimal runner type for list() — injectable for unit tests (see git.ts Spawner pattern). */
type ListRunner = (args: string[]) => { stdout: string; stderr: string; exitCode: number };

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

/** Escape a string for safe embedding inside a security -i single-quoted argument */
function shEscape(s: string): string {
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
    // security -i reads commands line-by-line; a value containing newlines
    // would terminate the current command and inject additional commands.
    if (/[\r\n]/.test(value)) {
      throw new Error(
        "Secret value must not contain newlines when using the macOS Keychain backend"
      );
    }

    const service = `${TARGET_PREFIX}${key}`;
    // Pass the command to `security -i` via stdin so the value never appears
    // in any process argument list (stdin content is IPC, not visible in ps).
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
    // Exit code 44 = item not found -- treat as no-op, same as Windows backend
    if (r.exitCode !== 0 && r.exitCode !== 44) {
      throw new Error(
        `Failed to delete credential '${key}': ${r.stderr.trim()}`
      );
    }
  }

  async list(prefix: string, runner: ListRunner = shRun): Promise<string[]> {
    if (/[*?]/.test(prefix)) {
      throw new Error(
        `list() prefix must not contain wildcard characters: "${prefix}"`
      );
    }

    // Scope the keychain dump to the user's login keychain so that we never
    // read system keychains, iCloud keychains, or other users' keychains.
    // Without a path argument `security dump-keychain` dumps ALL entries in
    // the default search list — browser passwords, Wi-Fi keys, app tokens, etc.
    // Passing ~/Library/Keychains/login.keychain-db restricts the dump to the
    // single file where see-crets items are stored (the .db extension is the
    // standard on macOS 10.9+). If HOME is unset we fall back gracefully.
    const keychainPath = process.env["HOME"]
      ? `${process.env["HOME"]}/Library/Keychains/login.keychain-db`
      : undefined;
    const args = keychainPath
      ? ["security", "dump-keychain", keychainPath]
      : ["security", "dump-keychain"];
    const r = runner(args);
    if (r.exitCode !== 0) return [];

    const fullPrefix = `${TARGET_PREFIX}${prefix}`;
    const results: string[] = [];

    // Each entry starts with a "keychain:" header line. Split on that to get
    // per-entry blocks, then check both "svce" and "acct" within the same
    // block to exclude entries from other apps with a coincidentally matching
    // service name.
    const blocks = r.stdout.split(/^keychain:/m);
    for (const block of blocks) {
      const svceMatch = /"svce"<blob>="([^"]+)"/.exec(block);
      const acctMatch = /"acct"<blob>="([^"]+)"/.exec(block);
      if (
        svceMatch &&
        acctMatch &&
        svceMatch[1].startsWith(fullPrefix) &&
        acctMatch[1] === ACCOUNT
      ) {
        results.push(svceMatch[1].slice(TARGET_PREFIX.length));
      }
    }
    return results;
  }
}
