import type { VaultBackend } from "../vault/types.ts";
import { detectBackend } from "../vault/detect.ts";
import { SAFE_VARNAME, resolveEnvMap, envVarForKey } from "./env-map.ts";

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
   *
   * Includes both placeholder-resolved vars (_SC_N) and auto-mapped vars
   * (e.g. GITHUB_TOKEN) when autoInject is enabled.
   */
  env: Record<string, string>;
  /** Key names that were injected — safe to log (no values). */
  keys: string[];
}

export interface InjectOptions {
  /**
   * When true (default), all vault keys whose names match the env-var map are
   * automatically injected into the subprocess env — no placeholder syntax needed.
   *
   * Disable if you want placeholder-only injection with no automatic mapping.
   */
  autoInject?: boolean;
  /**
   * Directory used to locate `.see-crets.json` for per-project map overrides.
   * If omitted, only the built-in map is used.
   */
  projectDir?: string;
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
  options: InjectOptions = {},
): Promise<InjectResult> {
  const { autoInject = true, projectDir } = options;
  const placeholders = [...command.matchAll(PLACEHOLDER_RE)];

  const resolvedBackend = backend ?? (await detectBackend());
  const env: Record<string, string> = {};
  const keys: string[] = [];

  // --- Placeholder resolution ---
  if (placeholders.length > 0) {
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

    command = command.replace(
      PLACEHOLDER_RE,
      (_, key: string) => shellRef(keyToVar.get(key)!),
    );
  }

  // --- Auto-inject via env-var map ---
  if (autoInject) {
    const envMap = resolveEnvMap(projectDir);
    const allKeys = await resolvedBackend.list("");

    // Deterministic precedence: project-namespaced keys win over global/ keys.
    // Within each group, sort alphabetically so the result is stable regardless
    // of the order in which the backend returns keys.
    const sortedKeys = [...allKeys].sort((a, b) => {
      const aGlobal = a.startsWith("global/");
      const bGlobal = b.startsWith("global/");
      if (aGlobal !== bGlobal) return aGlobal ? 1 : -1; // project first
      return a.localeCompare(b);
    });

    const seenVars = new Set<string>();
    for (const qualifiedKey of sortedKeys) {
      const targetVar = envVarForKey(qualifiedKey, envMap);
      if (!targetVar) continue;
      if (!SAFE_VARNAME.test(targetVar)) {
        throw new Error(
          `Unsafe env-var name from project map for key "${qualifiedKey}": "${targetVar}"`,
        );
      }
      // Skip if this key was already injected via a placeholder.
      if (keys.includes(qualifiedKey)) continue;
      // First matching key for this env var wins (project > global precedence).
      if (seenVars.has(targetVar)) continue;
      const value = await resolvedBackend.get(qualifiedKey);
      if (value === null) continue; // key disappeared between list and get — skip
      env[targetVar] = value;
      keys.push(qualifiedKey);
      seenVars.add(targetVar);
    }
  }

  return { command, env, keys };
}
