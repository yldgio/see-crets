/**
 * Windows DPAPI file-based fallback vault backend.
 *
 * Used when Windows Credential Manager is unavailable (disabled by policy,
 * certain CI environments, etc.). Stores DPAPI-encrypted blobs in a JSON file
 * at %APPDATA%\see-crets\vault.dpapi.
 *
 * Encryption: [System.Security.Cryptography.ProtectedData]::Protect with
 * DataProtectionScope.CurrentUser — OS-native, user-account bound, no
 * passwords required, survives reboots.
 *
 * Security note: less integrated than Credential Manager (no GUI browsing,
 * no Windows Hello sync, no domain roaming). Credential Manager is preferred
 * when available.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { isAbsolute, join } from "path";
import type { VaultBackend } from "./types.ts";
import { validateKey } from "./shared.ts";

/**
 * Resolve the vault directory from well-known Windows user-profile env vars.
 * Returns an absolute path, or empty string if none can be found.
 * An empty string signals that the backend is unavailable.
 */
function resolveVaultDir(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.USERPROFILE;
  if (!base) return "";
  const dir = join(base, "see-crets");
  return isAbsolute(dir) ? dir : "";
}

const _DEFAULT_VAULT_DIR = resolveVaultDir();

/**
 * Absolute path to the DPAPI vault file, or empty string if the user-profile
 * directory could not be resolved. Exported for use in detectResult().
 */
export const VAULT_FILE_PATH: string = _DEFAULT_VAULT_DIR
  ? join(_DEFAULT_VAULT_DIR, "vault.dpapi")
  : "";

function psRun(
  script: string,
  env?: Record<string, string>
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = Bun.spawnSync(
      ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
      { env: env ? { ...process.env, ...env } : process.env }
    );
    return {
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
      exitCode: result.exitCode ?? -1,
    };
  } catch {
    return { stdout: "", stderr: "", exitCode: -1 };
  }
}

export class WindowsDPAPIFileBackend implements VaultBackend {
  readonly name = "Windows DPAPI File";
  private readonly vaultDir: string;
  private readonly vaultFile: string;

  /** `overrideVaultDir` is for testing only; production code omits it. */
  constructor(overrideVaultDir?: string) {
    this.vaultDir = overrideVaultDir ?? _DEFAULT_VAULT_DIR;
    this.vaultFile = this.vaultDir
      ? join(this.vaultDir, "vault.dpapi")
      : "";
  }

  async isAvailable(): Promise<boolean> {
    // No absolute vault dir means no user-profile env var was found — unavailable.
    if (!this.vaultDir) return false;
    // DPAPI (ProtectedData) is present on all Windows versions since Vista.
    // Probe with a round-trip encrypt/decrypt of a test byte.
    const script = `
Add-Type -AssemblyName System.Security
try {
    $b = [System.Text.Encoding]::UTF8.GetBytes("probe")
    $enc = [System.Security.Cryptography.ProtectedData]::Protect(
        $b, $null,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [System.Security.Cryptography.ProtectedData]::Unprotect(
        $enc, $null,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    ) | Out-Null
    exit 0
} catch {
    exit 1
}
`;
    const r = psRun(script);
    return r.exitCode === 0;
  }

  private _readVault(): Record<string, string> {
    if (!existsSync(this.vaultFile)) return {};
    try {
      return JSON.parse(readFileSync(this.vaultFile, "utf8"));
    } catch (e) {
      throw new Error(
        `Vault file at ${this.vaultFile} exists but could not be parsed. ` +
          `Manual intervention required. Underlying error: ${(e as Error).message}`
      );
    }
  }

  private _writeVault(vault: Record<string, string>): void {
    mkdirSync(this.vaultDir, { recursive: true });
    // Write to a temp file then rename for crash-safe atomicity.
    const tmp = this.vaultFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(vault, null, 2), "utf8");
    renameSync(tmp, this.vaultFile);
  }

  private _encrypt(value: string): string {
    const script = `
Add-Type -AssemblyName System.Security
$bytes = [System.Text.Encoding]::UTF8.GetBytes($env:SC_VAL)
$protected = [System.Security.Cryptography.ProtectedData]::Protect(
    $bytes, $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
Write-Output ([Convert]::ToBase64String($protected))
`;
    const r = psRun(script, { SC_VAL: value });
    if (r.exitCode !== 0 || !r.stdout.trim()) {
      throw new Error(`DPAPI encrypt failed: ${r.stderr.trim()}`);
    }
    return r.stdout.trim();
  }

  private _decrypt(blob: string): string {
    const script = `
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String($env:SC_BLOB)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $bytes, $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
Write-Output ([System.Text.Encoding]::UTF8.GetString($plain))
`;
    const r = psRun(script, { SC_BLOB: blob });
    if (r.exitCode !== 0) {
      throw new Error(`DPAPI decrypt failed: ${r.stderr.trim()}`);
    }
    // Strip the single trailing newline added by PowerShell's Write-Output,
    // preserving intentional leading/trailing whitespace in the secret value.
    return r.stdout.replace(/\r?\n$/, "");
  }

  async set(key: string, value: string): Promise<void> {
    validateKey(key);
    const vault = this._readVault();
    vault[key] = this._encrypt(value);
    this._writeVault(vault);
  }

  async get(key: string): Promise<string | null> {
    validateKey(key);
    const vault = this._readVault();
    if (!(key in vault)) return null;
    // Let _decrypt throw on failure — a decrypt error is not the same as "key not found".
    return this._decrypt(vault[key]);
  }

  async delete(key: string): Promise<void> {
    validateKey(key);
    const vault = this._readVault();
    delete vault[key];
    this._writeVault(vault);
  }

  async list(prefix: string): Promise<string[]> {
    if (/[*?]/.test(prefix)) {
      throw new Error(
        `list() prefix must not contain wildcard characters: "${prefix}"`
      );
    }
    const vault = this._readVault();
    return Object.keys(vault).filter((k) => k.startsWith(prefix));
  }
}

