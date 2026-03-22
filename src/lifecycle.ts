/**
 * Human-only secret lifecycle operations: delete, purge, rotate.
 *
 * ⚠️  These functions must NOT be registered in any LLM tool schema or plugin
 *     manifest (OpenCode, Copilot CLI, Claude Code, etc.).  They are intentionally
 *     kept outside src/tools/ to make this boundary visible.
 *
 * Shared with src/cli.ts so that the logic is unit-testable without spawning
 * a subprocess or touching the OS vault in tests.
 */

import type { VaultBackend } from "./vault/types.ts";
import { getProjectName, isInGitRepo } from "./utils/git.ts";

// Re-export masked input primitives so cli.ts only imports from one place.
export { readMaskedInput, CancellationError } from "./tools/ask-secret-set.ts";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface DeleteResult {
  deleted: true;
  key: string;
  namespace: string;
}

export interface PurgeResult {
  purged: number;
  namespace: string;
  keys: string[];
}

export interface RotateResult {
  rotated: true;
  key: string;
  namespace: string;
}

// ---------------------------------------------------------------------------
// Namespace resolution (shared across all lifecycle commands)
// ---------------------------------------------------------------------------

/**
 * Qualifies a bare key name with a namespace prefix.
 *
 * - If `rawKey` already contains a `/` it is returned as-is (already qualified).
 * - Otherwise: if `projectOverride` is provided it is used as the namespace;
 *   if inside a git repo the repo basename is used; else "global" is used.
 */
export function resolveKey(rawKey: string, projectOverride?: string): string {
  if (rawKey.includes("/")) return rawKey;
  const ns =
    projectOverride ?? (isInGitRepo() ? getProjectName() : "global");
  return `${ns}/${rawKey}`;
}

/**
 * Returns the namespace portion of a fully-qualified key.
 * e.g. "my-project/github-token" → "my-project"
 */
export function namespaceOf(qualifiedKey: string): string {
  const slash = qualifiedKey.lastIndexOf("/");
  return slash === -1 ? "global" : qualifiedKey.slice(0, slash);
}

// ---------------------------------------------------------------------------
// Lifecycle operations
// ---------------------------------------------------------------------------

/**
 * Deletes a single secret from the vault.
 * The key must already be fully qualified (use resolveKey first).
 */
export async function deleteSecret(
  backend: VaultBackend,
  qualifiedKey: string
): Promise<DeleteResult> {
  await backend.delete(qualifiedKey);
  return { deleted: true, key: qualifiedKey, namespace: namespaceOf(qualifiedKey) };
}

/**
 * Removes every secret stored under the given project namespace prefix.
 * Does NOT touch the `global/` namespace — throws if project === "global".
 *
 * Uses Promise.allSettled so partial failures are reported rather than
 * leaving the vault in an unknown state.
 */
export async function purgeSecrets(
  backend: VaultBackend,
  project: string
): Promise<PurgeResult> {
  if (project === "global") {
    throw new Error(
      "Refusing to purge the global namespace. " +
        "Use a project-specific namespace or --project <name>."
    );
  }

  const prefix = `${project}/`;
  const keys = await backend.list(prefix);
  const results = await Promise.allSettled(keys.map((k) => backend.delete(k)));

  const deleted = keys.filter((_, i) => results[i].status === "fulfilled");
  const failed = keys.filter((_, i) => results[i].status === "rejected");

  if (failed.length > 0) {
    throw new Error(
      `Partial purge: deleted ${deleted.length}/${keys.length} keys. ` +
        `Failed to delete: ${failed.join(", ")}`
    );
  }

  return { purged: deleted.length, namespace: project, keys: deleted };
}

/**
 * Updates an existing vault entry with a new value.
 * Uses backend.set() which overwrites in-place — no delete/re-add.
 * The key must already be fully qualified (use resolveKey first).
 *
 * Throws if the key does not already exist, preventing silent creation
 * of a new entry when the user makes a typo.
 */
export async function rotateSecret(
  backend: VaultBackend,
  qualifiedKey: string,
  newValue: string
): Promise<RotateResult> {
  const existing = await backend.get(qualifiedKey);
  if (existing === null) {
    throw new Error(
      `Cannot rotate '${qualifiedKey}': key does not exist in the vault. ` +
        `Use 'see-crets set ${qualifiedKey}' to create it first.`
    );
  }
  await backend.set(qualifiedKey, newValue);
  return { rotated: true, key: qualifiedKey, namespace: namespaceOf(qualifiedKey) };
}
