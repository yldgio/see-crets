import type { VaultBackend } from "../vault/types.ts";
import { detectBackend } from "../vault/detect.ts";

const PLACEHOLDER_RE = /\{\{SECRET:([^}]+)\}\}/g;

/**
 * Thrown when a `{{SECRET:key}}` placeholder references a key that does not
 * exist in the vault.
 */
export class SecretNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Secret not found in vault: "${key}"`);
    this.name = "SecretNotFoundError";
  }
}

export interface InjectResult {
  /** Command with every {{SECRET:key}} placeholder replaced by a shell var ref. */
  command: string;
  /**
   * Subprocess-scoped env vars to pass to spawn() ONLY.
   * NEVER assign these to process.env — values must not outlive the subprocess.
   */
  env: Record<string, string>;
  /** Key names that were injected — safe to log (no values). */
  keys: string[];
}

/**
 * Return the platform-appropriate reference to an env var inside a shell command.
 * Windows cmd: `%VAR%`
 * Unix shells: `${VAR}` — brace form prevents accidental identifier extension when
 *   an alphanumeric/underscore character immediately follows the placeholder.
 */
function shellRef(varName: string): string {
  return process.platform === "win32" ? `%${varName}%` : `\${${varName}}`;
}

/**
 * Parse every `{{SECRET:key}}` placeholder in `command`, retrieve the values
 * from the vault, replace placeholders with subprocess-scoped env var references,
 * and return the modified command together with the env map.
 *
 * Env var names are opaque sequential identifiers (`_SC_0`, `_SC_1`, …) so that
 * distinct vault keys that would normalise to the same string (e.g. `a-b` and
 * `a_b`) never collide.
 *
 * The returned `env` object must be merged into the subprocess options only:
 *   spawn(cmd, { env: { ...process.env, ...result.env } })
 *
 * process.env is NEVER mutated.
 *
 * @throws SecretNotFoundError if any referenced key is absent from the vault.
 */
export async function injectSecrets(
  command: string,
  backend?: VaultBackend,
): Promise<InjectResult> {
  const placeholders = [...command.matchAll(PLACEHOLDER_RE)];
  if (placeholders.length === 0) {
    return { command, env: {}, keys: [] };
  }

  const resolvedBackend = backend ?? (await detectBackend());
  const env: Record<string, string> = {};
  const keys: string[] = [];

  // Assign each unique key a stable, collision-proof env var name.
  const keyToVar = new Map<string, string>();
  const uniqueKeys = [...new Set(placeholders.map((m) => m[1]))];
  let idx = 0;
  for (const key of uniqueKeys) {
    const value = await resolvedBackend.get(key);
    if (value === null) {
      throw new SecretNotFoundError(key);
    }
    const varName = `_SC_${idx++}`;
    keyToVar.set(key, varName);
    env[varName] = value;
    keys.push(key);
  }

  // Replace all occurrences in the command (including duplicates of the same key).
  const modifiedCommand = command.replace(
    PLACEHOLDER_RE,
    (_, key: string) => shellRef(keyToVar.get(key)!),
  );

  return { command: modifiedCommand, env, keys };
}
