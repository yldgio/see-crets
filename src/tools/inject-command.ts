import { injectSecrets, type InjectResult } from "../hook/inject.ts";
import type { VaultBackend } from "../vault/types.ts";

/**
 * Resolves `{{SECRET:key}}` placeholders and auto-injects vault keys that
 * match the built-in env-var map. Returns the modified command, the
 * subprocess-scoped env map (with actual values), and the list of key names.
 *
 * @param command  The shell command string to process.
 * @param backend  Optional vault backend override (used in tests).
 */
export async function injectCommand(
  command: string,
  backend?: VaultBackend,
): Promise<InjectResult> {
  return await injectSecrets(command, backend, { autoInject: true });
}

/**
 * CLI entry point for `see-crets inject`.
 *
 * Reads a command from stdin, resolves secrets, and writes an
 * `InjectResult` JSON object to stdout. Hook scripts consume this output
 * to build subprocess-scoped env assignments and the scrub key list.
 *
 * Exit codes:
 *   0 — success (JSON written to stdout)
 *   1 — no command provided on stdin
 */
export async function runInjectCommand(): Promise<void> {
  const command = (await Bun.stdin.text()).trim();
  if (!command) {
    process.stderr.write(
      JSON.stringify({ error: "No command provided on stdin" }) + "\n",
    );
    process.exit(1);
  }
  const result = await injectCommand(command);
  process.stdout.write(JSON.stringify(result) + "\n");
}
