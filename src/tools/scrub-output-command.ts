import { detectBackend } from "../vault/detect.ts";
import { scrub } from "../hook/scrub.ts";
import { getProjectName, isInGitRepo } from "../utils/git.ts";
import type { VaultBackend } from "../vault/types.ts";

/**
 * Scrubs every vault secret value from `input`.
 *
 * Retrieves all values stored for the current project namespace and the
 * `global/` namespace, then delegates to `scrub()` from the hook library.
 *
 * **Throws** if the vault is unavailable or any vault operation fails.
 * Previously, vault errors were silently swallowed and the raw (potentially
 * secret-containing) `input` was returned — a fail-open vulnerability.
 * Callers are now responsible for deciding the fallback policy:
 * - CLI callers: use `runScrubOutputCommand()` which fails **closed** by default.
 * - Plugin/library callers: catch and choose a context-appropriate fallback.
 *
 * @param input    Raw tool output (stdout / stderr) to scrub.
 * @param backend  Optional vault backend override (used in tests).
 * @throws {Error} When the vault is unavailable or a vault operation fails.
 */
export async function scrubOutput(
  input: string,
  backend?: VaultBackend,
): Promise<string> {
  // No try/catch here — vault errors are re-thrown so callers decide the fallback
  // policy. The old catch { return input } was fail-open: it silently returned
  // unscrubbed output (potentially containing live secrets) to the LLM.
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
}

/**
 * Written to stdout when the vault is unavailable and `--fail-open` is not set.
 * Exported so callers and tests can assert the exact suppression message.
 */
export const OUTPUT_SUPPRESSED_MSG =
  "[OUTPUT SUPPRESSED: vault unavailable for scrubbing. Re-run when the vault is accessible.]\n";

/**
 * CLI entry point for `see-crets scrub-output`.
 *
 * Reads raw text from stdin, scrubs every known vault value, and writes the
 * redacted result to stdout. Used by pre-secrets hook scripts to sanitise
 * subprocess output before the runtime returns it to the LLM.
 *
 * **Fail-closed by default**: if the vault is unavailable, writes
 * `OUTPUT_SUPPRESSED_MSG` to stdout instead of the raw input, preventing live
 * secrets from reaching the LLM. Pass `--fail-open` to revert to the original
 * behaviour (raw input written on vault error) for tooling that explicitly opts in.
 *
 * Always exits 0. Fails **closed** by default — output is suppressed (not leaked)
 * when the vault is unavailable. This is intentional: the old "never lose output"
 * contract was the vulnerability. Use `--fail-open` to restore it explicitly.
 */
export async function runScrubOutputCommand(): Promise<void> {
  const failOpen = process.argv.includes("--fail-open");
  let input = "";
  try {
    input = await Bun.stdin.text();
  } catch {
    // Stdin read failure — nothing to write, exit cleanly
    return;
  }
  try {
    const scrubbed = await scrubOutput(input);
    process.stdout.write(scrubbed);
  } catch {
    if (failOpen) {
      // Caller explicitly opted in to fail-open: return raw input rather than suppressing
      process.stdout.write(input);
    } else {
      // Default: fail closed — suppress output to avoid leaking live secrets to the LLM
      process.stdout.write(OUTPUT_SUPPRESSED_MSG);
    }
  }
}
