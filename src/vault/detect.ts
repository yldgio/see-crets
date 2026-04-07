import { existsSync } from "fs";
import type { VaultBackend } from "./types.ts";
import type { DetectResult } from "./types.ts";

/**
 * When Credential Manager is available, silently migrate any secrets that were
 * written to the DPAPI file backend during a previous fallback period. Best-effort:
 * per-key failures are skipped; whole-migration failures are ignored.
 */
async function tryMigrateFromDPAPI(credManager: VaultBackend): Promise<void> {
  try {
    const { WindowsDPAPIFileBackend, VAULT_FILE_PATH } = await import(
      "./windows-dpapi.ts"
    );
    if (!VAULT_FILE_PATH || !existsSync(VAULT_FILE_PATH)) return;
    const dpapi = new WindowsDPAPIFileBackend();
    const keys = await dpapi.list("");
    if (keys.length === 0) return;
    for (const key of keys) {
      try {
        const val = await dpapi.get(key);
        if (val !== null) {
          await credManager.set(key, val);
          await dpapi.delete(key);
        }
      } catch {
        // Per-key failure — leave in DPAPI, continue with remaining keys.
      }
    }
  } catch {
    // Whole migration failed — Credential Manager is still used going forward.
  }
}

/**
 * Detects the current OS and returns the appropriate vault backend.
 * The optional `platform` parameter exists for testability; it defaults to
 * `process.platform`.
 */
export async function detectBackend(
  platform: string = process.platform
): Promise<VaultBackend> {
  if (platform === "win32") {
    const { WindowsVaultBackend } = await import("./windows.ts");
    const credManager = new WindowsVaultBackend();
    if (await credManager.isAvailable()) {
      await tryMigrateFromDPAPI(credManager);
      return credManager;
    }

    const { WindowsDPAPIFileBackend } = await import("./windows-dpapi.ts");
    const dpapi = new WindowsDPAPIFileBackend();
    if (await dpapi.isAvailable()) {
      return dpapi;
    }

    throw new Error(
      "No Windows vault backend available. " +
        "Windows Credential Manager is disabled and DPAPI is unavailable. " +
        "Check Group Policy or run `see-crets detect` for details."
    );
  }

  if (platform === "darwin") {
    const { MacosVaultBackend } = await import("./macos.ts");
    const backend = new MacosVaultBackend();
    if (!(await backend.isAvailable())) {
      throw new Error(
        "macOS Keychain (security CLI) is not available on this machine."
      );
    }
    return backend;
  }

  if (platform === "linux") {
    const { LinuxVaultBackend } = await import("./linux.ts");
    const backend = new LinuxVaultBackend();
    if (!(await backend.isAvailable())) {
      throw new Error(
        "No vault backend available. Install libsecret-tools (secret-tool) or pass."
      );
    }
    return backend;
  }

  throw new Error(
    `Vault backend is not supported on this platform: ${platform}`
  );
}

/** Returns a DetectResult without throwing -- used by the `detect` command */
export async function detectResult(platform?: string): Promise<DetectResult> {
  try {
    const backend = await detectBackend(platform);
    const result: DetectResult = { available: true, backend: backend.name };
    if (backend.name === "Windows DPAPI File") {
      const { VAULT_FILE_PATH } = await import("./windows-dpapi.ts");
      result.detail =
        "Windows Credential Manager unavailable; using DPAPI-encrypted file store " +
        `(${VAULT_FILE_PATH}).`;
    }
    return result;
  } catch (err) {
    return {
      available: false,
      backend: "none",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
