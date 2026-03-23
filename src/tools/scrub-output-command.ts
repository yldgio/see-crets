import { detectBackend } from "../vault/detect.ts";
import { scrub } from "../hook/scrub.ts";
import { getProjectName, isInGitRepo } from "../utils/git.ts";
import type { VaultBackend } from "../vault/types.ts";

/**
 * Scrubs every vault secret value from `input`.
 *
 * Retrieves all values stored for the current project namespace and the
 * `global/` namespace, then delegates to `scrub()` from the hook library.
 * On any vault error the original `input` is returned unchanged so tool
 * output is never silently discarded.
 *
 * @param input    Raw tool output (stdout / stderr) to scrub.
 * @param backend  Optional vault backend override (used in tests).
 */
export async function scrubOutput(
  input: string,
  backend?: VaultBackend,
): Promise<string> {
  try {
    const resolvedBackend = backend ?? (await detectBackend());
    const project = isInGitRepo() ? getProjectName() : "global";
    const prefixes =
      project === "global" ? ["global/"] : [`${project}/`, "global/"];
    const keysets = await Promise.all(
      prefixes.map((p) => resolvedBackend.list(p)),
    );
    const allKeys = [...new Set(keysets.flat())];
    const maybeValues = await Promise.all(
      allKeys.map((k) => resolvedBackend.get(k)),
    );
    const values = maybeValues.filter((v): v is string => v !== null);
    return scrub(input, values);
  } catch {
    // Vault unavailable or empty — return unscrubbed rather than blocking output
    return input;
  }
}

/**
 * CLI entry point for `see-crets scrub-output`.
 *
 * Reads raw text from stdin, scrubs every known vault value, and writes the
 * redacted result to stdout. Used by pre-secrets hook scripts to sanitise
 * subprocess output before the runtime returns it to the LLM.
 *
 * Always exits 0 — output must not be lost due to a scrub failure.
 */
export async function runScrubOutputCommand(): Promise<void> {
  const input = await Bun.stdin.text();
  const scrubbed = await scrubOutput(input);
  process.stdout.write(scrubbed);
}
