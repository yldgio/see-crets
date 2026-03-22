import path from "path";

/** Minimal subset of Bun.spawnSync result used by this module. */
type SpawnResult = { exitCode: number | null; stdout: BufferSource };

/** Spawner function type — injectable for testing. */
export type Spawner = (cmd: string[]) => SpawnResult;

const defaultSpawner: Spawner = (cmd) =>
  Bun.spawnSync(cmd, { stderr: "ignore" });

/**
 * Returns the project name derived from the git root directory basename.
 * Falls back to "global" when outside a git repository or on any error.
 *
 * @param spawner Optional spawner override (for tests).
 */
export function getProjectName(spawner: Spawner = defaultSpawner): string {
  try {
    const result = spawner(["git", "rev-parse", "--show-toplevel"]);
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
 *
 * @param spawner Optional spawner override (for tests).
 */
export function isInGitRepo(spawner: Spawner = defaultSpawner): boolean {
  try {
    const result = spawner(["git", "rev-parse", "--show-toplevel"]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
