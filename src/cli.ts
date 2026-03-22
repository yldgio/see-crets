#!/usr/bin/env bun
/**
 * see-crets CLI entry point
 *
 * LLM-callable commands (safe — return no secret values):
 *   set <key>     — Human-in-the-loop masked input; stores in OS vault
 *   list          — Key names only, never values
 *   detect        — Vault backend health check
 *
 * Human-only commands (destructive — NOT exposed to LLM tool schema):
 *   delete <key>  — Remove a secret from the vault
 *   rotate <key>  — Replace a secret value (masked input, overwrites in place)
 *   purge         — Remove all secrets for the current project namespace
 *
 * Exit codes:
 *   0 — success
 *   1 — usage error / operation failed
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

function usage(): never {
  console.error(`
see-crets — OS-native secret vault for AI agents

LLM-callable commands (safe — return no secret values):
  see-crets set <key>        Store a secret (masked input)
  see-crets list             List key names for current project + global
  see-crets detect           Report vault backend health

Human-only commands (destructive — NOT exposed to LLM tools):
  see-crets delete <key>     Delete a secret from the vault
  see-crets rotate <key>     Replace a secret value (masked input, no delete/re-add)
  see-crets purge            Remove ALL secrets for the current project namespace

Options:
  --project <name>           Override the project namespace (default: git root basename)
`);
  process.exit(1);
}

const args = process.argv.slice(2);
const cmd = args[0];

// Parse --project flag
let projectFlag: string | undefined;
const projectIdx = args.indexOf("--project");
if (projectIdx !== -1 && args[projectIdx + 1]) {
  projectFlag = args[projectIdx + 1];
}

/**
 * Returns positional arguments with --flag value pairs removed.
 * e.g. ['set', '--project', 'foo', 'my-key'] → ['set', 'my-key']
 */
function positionalArgs(): string[] {
  return args.filter(
    (a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--"))
  );
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
        console.error(JSON.stringify({ error: "No value entered — secret was NOT rotated." }));
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
      const backend = await detectBackend();
      const result = await purgeSecrets(backend, project);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default:
      usage();
  }
}

main().catch((err) => {
  if (err instanceof CancellationError) {
    // User pressed Ctrl+C — exit silently with code 1
    process.exit(1);
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ error: msg }));
  process.exit(1);
});
