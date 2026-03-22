import type { VaultBackend } from "./types.ts";
import type { DetectResult } from "./types.ts";

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
    const backend = new WindowsVaultBackend();
    if (!(await backend.isAvailable())) {
      throw new Error(
        "Windows Credential Manager is not available on this machine."
      );
    }
    return backend;
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
export async function detectResult(): Promise<DetectResult> {
  try {
    const backend = await detectBackend();
    return { available: true, backend: backend.name };
  } catch (err) {
    return {
      available: false,
      backend: "none",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
