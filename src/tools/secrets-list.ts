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

  let project: string;
  let note: string | undefined;

  if (projectOverride !== undefined) {
    // Override provided — skip git detection entirely; no misleading note
    project = projectOverride;
  } else {
    const inRepo = isInGitRepo();
    project = inRepo ? getProjectName() : "global";
    if (!inRepo) {
      note = "No git root found — operating in global namespace";
    }
  }

  // Collect keys from both project namespace and global namespace (deduplicated)
  const prefixes =
    project === "global" ? ["global/"] : [`${project}/`, "global/"];

  const keysets = await Promise.all(prefixes.map((p) => backend.list(p)));
  const keys = [...new Set(keysets.flat())];

  return {
    keys,
    namespace: project,
    ...(note ? { note } : {}),
  };
}
