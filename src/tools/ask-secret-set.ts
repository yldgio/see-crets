import { detectBackend } from "../vault/detect.ts";
import { getProjectName, isInGitRepo } from "../utils/git.ts";

/**
 * Thrown when the user cancels masked input (Ctrl+C).
 * Callers (e.g. the CLI entry point) should catch this and decide the exit code.
 */
export class CancellationError extends Error {
  constructor() {
    super("Input cancelled by user (Ctrl+C)");
    this.name = "CancellationError";
  }
}

export interface SetResult {
  stored: true;
  key: string;
  namespace: string;
}

export interface NonInteractiveResult {
  stored: false;
  key: string;
  instructions: string;
}

/**
 * Core security boundary: the LLM triggers this tool but never sees the secret value.
 *
 * Interactive (TTY): prompts the human for the value with masked input; value is written
 *   directly to the OS vault and never appears in tool output.
 *
 * Non-interactive (piped/CI): returns JSON instructions telling the human to run
 *   `see-crets set <key>` in a separate terminal.  The value never passes through
 *   this code path.
 *
 * @param rawKey  Key name as provided — will be namespaced automatically.
 * @param project Optional project override (defaults to git-root basename or "global").
 */
export async function askSecretSet(
  rawKey: string,
  project?: string
): Promise<SetResult | NonInteractiveResult> {
  // Only shell out to git when no project override is provided.
  const ns = project ?? (isInGitRepo() ? getProjectName() : "global");
  const qualifiedKey = rawKey.includes("/") ? rawKey : `${ns}/${rawKey}`;

  if (!process.stdin.isTTY) {
    // In non-interactive mode, check if the key already exists in the vault.
    // This is safe: we only inspect key names, never values.
    try {
      const backend = await detectBackend();
      const prefix = qualifiedKey.includes("/")
        ? qualifiedKey.slice(0, qualifiedKey.lastIndexOf("/") + 1)
        : "";
      const existing = await backend.list(prefix);
      if (existing.includes(qualifiedKey)) {
        const nsFromKey = qualifiedKey.includes("/")
          ? qualifiedKey.slice(0, qualifiedKey.lastIndexOf("/"))
          : ns;
        return { stored: true, key: qualifiedKey, namespace: nsFromKey };
      }
    } catch {
      // Vault unavailable in CI — fall through to instructions
    }

    return {
      stored: false,
      key: qualifiedKey,
      instructions: [
        `No interactive terminal detected.`,
        `Open a separate terminal and run:`,
        ``,
        `  see-crets set ${qualifiedKey}`,
        ``,
        `Then re-run your current task — the agent will find the key in the vault.`,
      ].join("\n"),
    };
  }

  const value = await readMaskedInput(
    `Enter value for '${qualifiedKey}': `
  );

  if (!value) {
    throw new Error("No value entered — secret was NOT stored.");
  }

  const backend = await detectBackend();
  await backend.set(qualifiedKey, value);

  return {
    stored: true,
    key: qualifiedKey,
    namespace: ns,
  };
}

/**
 * Reads a password from stdin with echoing disabled.
 * The typed characters are hidden from the terminal.
 */
async function readMaskedInput(prompt: string): Promise<string> {
  process.stderr.write(prompt);

  return new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;

    const restoreRawMode = () => {
      if (isTTYWithRawMode(stdin)) {
        (stdin as NodeJS.ReadStream & { setRawMode: (mode: boolean) => void }).setRawMode(false);
      }
    };

    const restoreAndResolve = (value: string) => {
      stdin.removeListener("data", handler);
      stdin.removeListener("error", restoreAndReject);
      restoreRawMode();
      process.stderr.write("\n");
      resolve(value);
    };

    const restoreAndReject = (err: Error) => {
      stdin.removeListener("data", handler);
      stdin.removeListener("error", restoreAndReject);
      restoreRawMode();
      reject(err);
    };

    if (isTTYWithRawMode(stdin)) {
      (stdin as NodeJS.ReadStream & { setRawMode: (mode: boolean) => void }).setRawMode(true);
    }
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";

    function handler(chunk: string) {
      for (const char of chunk) {
        switch (char) {
          case "\r":
          case "\n":
          case "\u0004": // EOT (Ctrl+D)
            stdin.pause();
            restoreAndResolve(value);
            return;

          case "\u0003": // Ctrl+C
            stdin.pause();
            restoreRawMode();
            stdin.removeListener("data", handler);
            stdin.removeListener("error", restoreAndReject);
            process.stderr.write("\n^C\n");
            reject(new CancellationError());
            return;

          case "\u007f": // DEL (backspace on most terminals)
          case "\u0008": // BS
            value = value.slice(0, -1);
            break;

          default:
            if (char >= " ") {
              value += char;
            }
        }
      }
    }

    stdin.on("data", handler);
    stdin.on("error", restoreAndReject);
  });
}

function isTTYWithRawMode(
  stream: NodeJS.ReadStream
): stream is NodeJS.ReadStream & { setRawMode: (mode: boolean) => void } {
  return stream.isTTY === true && typeof (stream as unknown as { setRawMode?: unknown }).setRawMode === "function";
}
