import path from "path";

/**
 * Returns the project name derived from the git root directory basename.
 * Falls back to "global" when outside a git repository or on any error.
 */
export function getProjectName(): string {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
      stderr: "ignore",
    });
    if (result.exitCode !== 0) return "global";
    const toplevel = result.stdout.toString().trim();
    if (!toplevel) return "global";
    return path.basename(toplevel);
  } catch {
    return "global";
  }
}

/**
 * Returns true when running inside a git repository.
 */
export function isInGitRepo(): boolean {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
      stderr: "ignore",
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
