import { detectBackend } from "../vault/detect.ts";
import { getProjectName, isInGitRepo } from "../utils/git.ts";

export interface ListResult {
  keys: string[];
  namespace: string;
  note?: string;
}

/**
 * Returns all key names for the current project namespace and the `global/` namespace.
 * NEVER returns secret values — key names only.
 */
export async function secretsList(projectOverride?: string): Promise<ListResult> {
  const backend = await detectBackend();
  const inRepo = isInGitRepo();
  const project = projectOverride ?? (inRepo ? getProjectName() : "global");

  const note = !inRepo
    ? "No git root found — operating in global namespace"
    : undefined;

  // Collect keys from both project namespace and global namespace (deduplicated)
  const prefixes =
    project === "global" ? ["global/"] : [`${project}/`, "global/"];

  const keysets = await Promise.all(prefixes.map((p) => backend.list(p)));
  const keys = [...new Set(keysets.flat())];

  return {
    keys,
    namespace: inRepo ? project : "global",
    ...(note ? { note } : {}),
  };
}
