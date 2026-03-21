import type { VaultBackend } from "./types.ts";
import type { DetectResult } from "./types.ts";

/**
 * Detects the current OS and returns the appropriate vault backend.
 * This is Phase 1 (Windows only). macOS and Linux backends are added in Phase 2.
 */
export async function detectBackend(): Promise<VaultBackend> {
  const platform = process.platform;

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
    throw new Error(
      "macOS Keychain backend is not yet implemented (Phase 2). " +
        "Run on Windows to use the current build."
    );
  }

  throw new Error(
    `Linux vault backend is not yet implemented (Phase 2). ` +
      `Detected platform: ${platform}`
  );
}

/** Returns a DetectResult without throwing — used by the `detect` command */
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
