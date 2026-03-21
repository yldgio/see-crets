/**
 * Windows Credential Manager vault backend.
 *
 * Storage target format: `see-crets:NAMESPACE/KEY`
 * Username field:        `see-crets` (constant sentinel)
 * Persist level:         CRED_PERSIST_LOCAL_MACHINE (2) — survives reboots, per-machine
 *
 * Credentials are read/written via Win32 CredRead/CredWrite P/Invoke called from an
 * inline PowerShell Add-Type block.  The secret value is always passed via an environment
 * variable (`SC_VAL`) so it never appears in process command-line arguments.
 */
import type { VaultBackend } from "./types.ts";

const TARGET_PREFIX = "see-crets:";
const CRED_USER = "see-crets";

/** Inline C# class compiled once per PowerShell invocation via Add-Type */
const WIN_CRED_TYPE = `
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinCred {
    public const int CRED_TYPE_GENERIC = 1;
    public const int CRED_PERSIST_LOCAL_MACHINE = 2;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public int    Flags;
        public int    Type;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
        [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
        public long   LastWritten;
        public int    CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int    Persist;
        public int    AttributeCount;
        public IntPtr Attributes;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
        [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, int type, int flags, out IntPtr pcred);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredWrite([In] ref CREDENTIAL cred, int flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredDelete(string target, int type, int flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredEnumerate(string filter, int flags, out int count, out IntPtr pcreds);

    [DllImport("advapi32.dll")]
    public static extern void CredFree(IntPtr pcred);

    public static string Get(string target) {
        IntPtr ptr;
        if (!CredRead(target, CRED_TYPE_GENERIC, 0, out ptr)) return null;
        var c = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
        string val = null;
        if (c.CredentialBlobSize > 0) {
            byte[] b = new byte[c.CredentialBlobSize];
            Marshal.Copy(c.CredentialBlob, b, 0, c.CredentialBlobSize);
            val = Encoding.Unicode.GetString(b);
        }
        CredFree(ptr);
        return val;
    }

    public static void Set(string target, string user, string value) {
        byte[] blob = Encoding.Unicode.GetBytes(value);
        IntPtr blobPtr = Marshal.AllocHGlobal(blob.Length);
        Marshal.Copy(blob, 0, blobPtr, blob.Length);
        var cred = new CREDENTIAL {
            Type               = CRED_TYPE_GENERIC,
            TargetName         = target,
            UserName           = user,
            CredentialBlob     = blobPtr,
            CredentialBlobSize = blob.Length,
            Persist            = CRED_PERSIST_LOCAL_MACHINE,
        };
        bool ok = CredWrite(ref cred, 0);
        Marshal.FreeHGlobal(blobPtr);
        if (!ok) throw new Exception("CredWrite failed: " + Marshal.GetLastWin32Error());
    }

    public static string[] List(string prefix) {
        int count = 0;
        IntPtr pcreds;
        if (!CredEnumerate(prefix + "*", 0, out count, out pcreds)) return new string[0];
        var targets = new string[count];
        for (int i = 0; i < count; i++) {
            IntPtr credPtr = Marshal.ReadIntPtr(pcreds, i * IntPtr.Size);
            var c = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
            targets[i] = c.TargetName;
        }
        CredFree(pcreds);
        return targets;
    }
}`;

function psRun(
  script: string,
  env?: Record<string, string>
): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(
    ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
    { env: env ? { ...process.env, ...env } : process.env }
  );
  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    exitCode: result.exitCode ?? -1,
  };
}

/** Escape a string for safe embedding inside a double-quoted PowerShell string */
function psEscape(s: string): string {
  return s
    .replace(/`/g, "``")
    .replace(/\$/g, "`$")
    .replace(/"/g, '`"')
    .replace(/\n/g, "`n")
    .replace(/\r/g, "`r");
}

export class WindowsVaultBackend implements VaultBackend {
  readonly name = "Windows Credential Manager";

  async isAvailable(): Promise<boolean> {
    const r = psRun("cmdkey /? 2>&1 | Out-Null; exit $LASTEXITCODE");
    return r.exitCode === 0;
  }

  async set(key: string, value: string): Promise<void> {
    if (/[\r\n]/.test(key)) {
      throw new Error(`Invalid key '${key}': key must not contain newlines`);
    }
    const target = psEscape(`${TARGET_PREFIX}${key}`);
    const script = `
Add-Type -TypeDefinition @"
${WIN_CRED_TYPE}
"@
$val = $env:SC_VAL
[WinCred]::Set("${target}", "${CRED_USER}", $val)
Write-Output "ok"
`;
    const r = psRun(script, { SC_VAL: value });
    if (r.exitCode !== 0 || !r.stdout.trim().includes("ok")) {
      throw new Error(`Failed to store credential '${key}': ${r.stderr.trim()}`);
    }
  }

  async get(key: string): Promise<string | null> {
    const target = psEscape(`${TARGET_PREFIX}${key}`);
    const script = `
Add-Type -TypeDefinition @"
${WIN_CRED_TYPE}
"@
$val = [WinCred]::Get("${target}")
if ($null -eq $val) { exit 1 }
Write-Output $val
`;
    const r = psRun(script);
    if (r.exitCode !== 0) return null;
    // Strip only the single trailing newline added by PowerShell's Write-Output,
    // preserving intentional leading/trailing whitespace in the secret value.
    return r.stdout.replace(/\r?\n$/, "") || null;
  }

  async delete(key: string): Promise<void> {
    const target = psEscape(`${TARGET_PREFIX}${key}`);
    const script = `
Add-Type -TypeDefinition @"
${WIN_CRED_TYPE}
"@
$ok = [WinCred]::CredDelete("${target}", [WinCred]::CRED_TYPE_GENERIC, 0)
if (-not $ok) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($err -ne 1168) { exit 1 }
}
Write-Output "ok"
`;
    const r = psRun(script);
    if (r.exitCode !== 0) {
      throw new Error(`Failed to delete credential '${key}': ${r.stderr.trim()}`);
    }
  }

  async list(prefix: string): Promise<string[]> {
    const filterPrefix = psEscape(`${TARGET_PREFIX}${prefix}`);
    const script = `
Add-Type -TypeDefinition @"
${WIN_CRED_TYPE}
"@
$targets = [WinCred]::List("${filterPrefix}")
$targets | ForEach-Object { Write-Output $_ }
`;
    const r = psRun(script);
    if (r.exitCode !== 0) return [];

    const prefixStrip = TARGET_PREFIX;
    return r.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith(prefixStrip))
      .map((l) => l.slice(prefixStrip.length));
  }
}
