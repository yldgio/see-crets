#!/usr/bin/env bun
/**
 * see-crets CLI entry point
 *
 * LLM-callable commands (safe — return no secret values):
 *   set <key>     — Human-in-the-loop masked input; stores in OS vault
 *   list          — Key names only, never values
 *   detect        — Vault backend health check
 *
 * Human-only commands (destructive — not exposed to LLM tools):
 *   delete <key>  — Remove a secret from the vault
 *   (rotate and purge are Phase 5)
 *
 * Exit codes:
 *   0 — success
 *   1 — usage error / operation failed
 */

import { askSecretSet } from "./tools/ask-secret-set.ts";
import { secretsList } from "./tools/secrets-list.ts";
import { secretsDetect } from "./tools/secrets-detect.ts";
import { detectBackend } from "./vault/detect.ts";

function usage(): never {
  console.error(`
see-crets — OS-native secret vault for AI agents

Usage:
  see-crets set <key>        Store a secret (masked input; LLM-callable)
  see-crets list             List key names for current project + global (LLM-callable)
  see-crets detect           Report vault backend health (LLM-callable)
  see-crets delete <key>     Delete a secret [human-only]

Options:
  --project <name>           Override the project namespace (default: git root basename)
  --json                     Output machine-readable JSON (default for set/list/detect)
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

async function main() {
  switch (cmd) {
    case "set": {
      const key = args[1];
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
      const key = args[1];
      if (!key) {
        console.error("Usage: see-crets delete <key>");
        process.exit(1);
      }
      const backend = await detectBackend();
      await backend.delete(key);
      console.log(JSON.stringify({ deleted: true, key }));
      break;
    }

    default:
      usage();
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ error: msg }));
  process.exit(1);
});
