#!/usr/bin/env bun
/**
 * see-crets CLI entry point
 *
 * LLM-callable commands (safe â€” return no secret values):
 *   set <key>     â€” Human-in-the-loop masked input; stores in OS vault
 *   list          â€” Key names only, never values
 *   detect        â€” Vault backend health check
 *
 * Human-only commands (destructive â€” NOT exposed to LLM tool schema):
 *   delete <key>  â€” Remove a secret from the vault
 *   rotate <key>  â€” Replace a secret value (masked input, overwrites in place)
 *   purge         â€” Remove all secrets for the current project namespace
 *
 * Exit codes:
 *   0 â€” success
 *   1 â€” usage error / operation failed
 */

import { askSecretSet } from "./tools/ask-secret-set.ts";
import { secretsList } from "./tools/secrets-list.ts";
import { secretsDetect } from "./tools/secrets-detect.ts";
import { detectBackend } from "./vault/detect.ts";
import {
  CancellationError,
  readMaskedInput,
  resolveKey,
  deleteSecret,
  purgeSecrets,
  rotateSecret,
} from "./lifecycle.ts";
import { getProjectName, isInGitRepo } from "./utils/git.ts";
import pkg from "../package.json";

function usage(): never {
  console.error(`
see-crets â€” OS-native secret vault for AI agents

LLM-callable commands (safe â€” return no secret values):
  see-crets set <key>        Store a secret (masked input)
  see-crets list             List key names for current project + global
  see-crets detect           Report vault backend health

Human-only commands (destructive â€” NOT exposed to LLM tools):
  see-crets delete <key>     Delete a secret from the vault
  see-crets rotate <key>     Replace a secret value (masked input, no delete/re-add)
  see-crets purge            Remove ALL secrets for the current project namespace
  see-crets uninstall        Remove the see-crets binary (vault data preserved)
  see-crets upgrade          Self-update to the latest release from GitHub

Options:
  --version, -v              Print version and exit
  --project <name>           Override the project namespace (default: git root basename)
`);
  process.exit(1);
}

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === "--version" || cmd === "-v") {
  console.log(`see-crets ${pkg.version}`);
  process.exit(0);
}

if (cmd === "--help" || cmd === "-h") {
  console.log(`
see-crets — OS-native secret vault for AI agents

Usage: see-crets <command> [options]

Commands:
  set <key>              Store a secret (masked input)
  get <key>              Retrieve a secret value
  delete <key>           Delete a secret from the vault
  list                   List key names for current project + global
  purge                  Remove ALL secrets for the current project namespace
  rotate <key>           Replace a secret value (masked input)
  inject                 Inject secrets as environment variables
  scrub-output           Scrub secret values from stdout/stderr
  uninstall              Remove the see-crets binary (vault data preserved)
  upgrade                Self-update to the latest release from GitHub
  ask-secret-set         Prompt for a secret and store it
  scrub-output-command   Run a command with output scrubbing

Options:
  --version, -v          Print version and exit
  --help, -h             Show this help message and exit
  --project <name>       Override the project namespace (default: git root basename)
  --global               Use the global namespace (alias for --project global)
  --yes                  Skip confirmation prompts (purge, uninstall)
`);
  process.exit(0);
}

// Parse --project flag â€” reject duplicate occurrences to avoid positional arg corruption.
const projectIndices = args.reduce<number[]>(
  (acc, a, i) => (a === "--project" ? [...acc, i] : acc),
  []
);
if (projectIndices.length > 1) {
  console.error("Error: --project may only be specified once.");
  process.exit(1);
}
let projectFlag: string | undefined;
const projectIdx = projectIndices[0] ?? -1;
if (projectIdx !== -1 && args[projectIdx + 1]) {
  projectFlag = args[projectIdx + 1];
}

// Parse --global flag - sets projectFlag to "global"; mutually exclusive with --project.
const globalIdx = args.indexOf("--global");
if (globalIdx !== -1) {
  if (projectIdx !== -1) {
    console.error("Error: --global and --project are mutually exclusive.");
    process.exit(1);
  }
  projectFlag = "global";
}

// Parse --yes flag - suppresses confirmation prompts (purge, uninstall).
const yesIdx = args.indexOf("--yes");
const yesFlag = yesIdx !== -1;

/**
 * Returns positional arguments with supported flag value pairs removed.
 * Strips: --project <name>, --global, --yes
 * e.g. ['set', '--project', 'foo', 'my-key'] -> ['set', 'my-key']
 */
function positionalArgs(): string[] {
  const skip = new Set<number>();
  if (projectIdx !== -1) {
    skip.add(projectIdx);
    if (projectIdx + 1 < args.length) {
      skip.add(projectIdx + 1);
    }
  }
  if (globalIdx !== -1) skip.add(globalIdx);
  if (yesIdx !== -1) skip.add(yesIdx);
  return args.filter((_, i) => !skip.has(i));
}

async function main() {
  switch (cmd) {
    case "set": {
      const key = positionalArgs()[1];
      if (!key) {
        console.error("Usage: see-crets set <key>");
        process.exit(1);
      }
      const result = await askSecretSet(key, projectFlag);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "list": {
      const result = await secretsList(projectFlag);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "detect": {
      const result = await secretsDetect();
      console.log(JSON.stringify(result, null, 2));
      if (!result.available) process.exit(1);
      break;
    }

    case "delete": {
      const key = positionalArgs()[1];
      if (!key) {
        console.error("Usage: see-crets delete <key>");
        process.exit(1);
      }
      const qualifiedKey = resolveKey(key, projectFlag);
      const backend = await detectBackend();
      const result = await deleteSecret(backend, qualifiedKey);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "rotate": {
      const key = positionalArgs()[1];
      if (!key) {
        console.error("Usage: see-crets rotate <key>");
        process.exit(1);
      }
      const qualifiedKey = resolveKey(key, projectFlag);
      const newValue = await readMaskedInput(`New value for '${qualifiedKey}': `);
      if (!newValue) {
        console.error(JSON.stringify({ error: "No value entered â€” secret was NOT rotated." }));
        process.exit(1);
      }
      const backend = await detectBackend();
      const result = await rotateSecret(backend, qualifiedKey, newValue);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "purge": {
      const project =
        projectFlag ?? (isInGitRepo() ? getProjectName() : "global");
      if (!yesFlag) {
        process.stderr.write(
          `⚠  This will permanently delete all secrets for project '${project}'.
` +
          `Type the project name to confirm, or press Enter to abort: `
        );
        const { readConfirmLine } = await import("./tools/uninstall-command.ts");
        const answer = await readConfirmLine();
        if (answer !== project) {
          console.log("Aborted.");
          process.exit(0);
        }
      }
      const backend = await detectBackend();
      const result = await purgeSecrets(backend, project);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "uninstall": {
      const { runUninstallCommand } = await import(
        "./tools/uninstall-command.ts"
      );
      await runUninstallCommand();
      break;
    }

    case "upgrade": {
      const { runUpgradeCommand } = await import(
        "./tools/upgrade-command.ts"
      );
      await runUpgradeCommand();
      break;
    }

    case "inject": {
      const { runInjectCommand } = await import("./tools/inject-command.ts");
      await runInjectCommand();
      break;
    }

    case "scrub-output": {
      const { runScrubOutputCommand } = await import(
        "./tools/scrub-output-command.ts"
      );
      await runScrubOutputCommand();
      break;
    }

    default:
      usage();
  }
}

main().catch((err) => {
  if (err instanceof CancellationError) {
    // User pressed Ctrl+C â€” exit silently with code 1
    process.exit(1);
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ error: msg }));
  process.exit(1);
});
