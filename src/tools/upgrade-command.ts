import { createHash } from "crypto";
import { rename, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "child_process";
import { join, dirname } from "node:path";
import { isCompiledBinary } from "./uninstall-command.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_API_URL =
  "https://api.github.com/repos/yldgio/see-crets/releases/latest";
const GITHUB_DOWNLOAD_BASE =
  "https://github.com/yldgio/see-crets/releases/download";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpgradeOptions {
  /** Override the "fetch latest tag" step — injectable for tests. */
  fetchLatestVersion?: () => Promise<string>;
  /** Override the full download+replace step — injectable for tests. */
  downloadAndReplace?: (tag: string, execPath: string) => Promise<void>;
  /** Override the current version string — injectable for tests. */
  currentVersion?: string;
  /** Override process.execPath — injectable for tests. */
  execPath?: string;
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

/**
 * Returns `true` when running on a musl libc system.
 * Detects via the presence of `/etc/alpine-release` (Alpine Linux) or
 * by running `ldd --version` and checking for "musl" in the output
 * (covers Void Linux, Chimera, and other non-Alpine musl distros).
 */
export function isMusl(): boolean {
  if (existsSync("/etc/alpine-release")) return true;
  try {
    const ldd = execSync("ldd --version 2>&1", { encoding: "utf8", timeout: 2000 });
    return ldd.includes("musl");
  } catch {
    return false;
  }
}

/**
 * Maps the current platform/arch to the release asset filename.
 * Throws if the platform is unsupported.
 */
export function getAssetName(
  platform: string = process.platform,
  arch: string = process.arch,
  musl: boolean = isMusl(),
): string {
  if (platform === "darwin") {
    if (arch === "arm64") return "see-crets-macos-arm64";
    if (arch === "x64") return "see-crets-macos-x64";
    throw new Error(`Unsupported architecture on macOS: ${arch}`);
  }

  if (platform === "linux") {
    const suffix = musl ? "-musl" : "";
    if (arch === "x64") return `see-crets-linux-x64${suffix}`;
    if (arch === "arm64") return `see-crets-linux-arm64${suffix}`;
    throw new Error(`Unsupported architecture on Linux: ${arch}`);
  }

  if (platform === "win32") {
    if (arch === "x64") return "see-crets-windows-x64.exe";
    throw new Error(`Unsupported architecture on Windows: ${arch}`);
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

// ---------------------------------------------------------------------------
// Network helpers (real implementations, overridden in tests)
// ---------------------------------------------------------------------------

/**
 * Fetches the latest release tag from GitHub.
 * Returns a tag string like "v0.2.0".
 */
export async function fetchLatestVersionFromGitHub(): Promise<string> {
  const res = await fetch(GITHUB_API_URL, {
    headers: {
      "User-Agent": "see-crets-upgrade",
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) {
    throw new Error(
      `GitHub API returned ${res.status} ${res.statusText}`,
    );
  }

  const json = (await res.json()) as { tag_name?: string };
  if (!json.tag_name) {
    throw new Error("GitHub API response missing tag_name");
  }

  return json.tag_name;
}

/**
 * Downloads a URL and returns the raw buffer.
 */
async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { "User-Agent": "see-crets-upgrade" },
  });

  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText} — ${url}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * Parses a checksums.txt file and returns the SHA256 for `filename`.
 * Expected format per line: `<sha256hex>  <filename>` or `<sha256hex> *<filename>`
 */
export function parseChecksums(
  content: string,
  filename: string,
): string | undefined {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Allow one or two spaces, optional asterisk before filename
    const match = trimmed.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (match && match[2].trim() === filename) {
      return match[1].toLowerCase();
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Core download + replace logic
// ---------------------------------------------------------------------------

/**
 * Downloads the release binary for `tag`, verifies SHA256, and atomically
 * replaces `execPath`.
 *
 * Throws on any verification or IO failure.
 */
export async function downloadAndReplaceBinary(
  tag: string,
  execPath: string,
): Promise<void> {
  const assetName = getAssetName();
  const checksumUrl = `${GITHUB_DOWNLOAD_BASE}/${tag}/checksums.txt`;
  const binaryUrl = `${GITHUB_DOWNLOAD_BASE}/${tag}/${assetName}`;

  // Download both in parallel
  const [checksumBuf, binaryBuf] = await Promise.all([
    downloadBuffer(checksumUrl),
    downloadBuffer(binaryUrl),
  ]);

  const checksumContent = checksumBuf.toString("utf8");
  const expectedHash = parseChecksums(checksumContent, assetName);

  if (!expectedHash) {
    throw new Error(
      `Checksum not found for '${assetName}' in checksums.txt`,
    );
  }

  // Verify SHA256
  const actualHash = createHash("sha256").update(binaryBuf).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(
      `SHA256 mismatch — expected ${expectedHash}, got ${actualHash}`,
    );
  }

  // Atomic write: temp file → rename
  const dir = dirname(execPath);
  const tmpPath = join(dir, `.see-crets-upgrade-${process.pid}.tmp`);

  await writeFile(tmpPath, binaryBuf);

  // Make executable on Unix + rename — wrapped in try/finally so the temp
  // file is cleaned up on any failure (chmod throws, rename throws, etc.).
  // Exception: on the Windows locked-binary path we intentionally preserve
  // the temp file so the user can manually complete the swap.
  let preserveTmp = false;
  try {
    // Make executable on Unix
    if (process.platform !== "win32") {
      await chmod(tmpPath, 0o755);
    }

    await rename(tmpPath, execPath);
  } catch (err) {
    // Windows: running .exe is file-locked — can't rename over it.
    // Preserve the temp file and tell the user where it is.
    if (
      process.platform === "win32" &&
      err instanceof Error &&
      ["EPERM", "EBUSY", "EACCES"].includes(
        ((err as NodeJS.ErrnoException).code) ?? "",
      )
    ) {
      preserveTmp = true;
      throw new Error(
        `Cannot replace the running binary on Windows.\n` +
          `Manually replace: ${execPath}\n` +
          `With: ${tmpPath}`,
      );
    }
    throw err;
  } finally {
    if (!preserveTmp) {
      // Best-effort cleanup — the rename succeeded (file is gone) or failed
      // for a non-Windows reason; either way, try to remove the temp file.
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(tmpPath);
      } catch {
        // Ignore — temp file either was renamed away or already gone.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Semver helpers
// ---------------------------------------------------------------------------

/**
 * Compares two semver strings (major.minor.patch[-prerelease]).
 * Returns  1 if a > b
 *          0 if a === b
 *         -1 if a < b
 *
 * Pre-release suffixes are handled per the semver spec: a pre-release version
 * is always less than the corresponding release (`1.0.0-beta.1 < 1.0.0`).
 * Missing or non-numeric parts are treated as 0.
 */
export function semverCompare(a: string, b: string): 1 | 0 | -1 {
  // Strip pre-release suffix before numeric comparison;
  // strip build metadata first so "1.0.0+build-1" isn't misclassified as pre-release
  const stripBuild = (v: string) => v.replace(/\+.*$/, "");
  const stripPre = (v: string) => stripBuild(v).replace(/-.*$/, "");
  const aHasPre = stripBuild(a).includes("-");
  const bHasPre = stripBuild(b).includes("-");

  const aParts = stripPre(a).split(".").map((n) => parseInt(n, 10) || 0);
  const bParts = stripPre(b).split(".").map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < 3; i++) {
    const av = aParts[i] ?? 0;
    const bv = bParts[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }

  // Numeric parts are equal — pre-release < release per semver spec
  if (aHasPre && !bHasPre) return -1;
  if (!aHasPre && bHasPre) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Core upgrade logic (injectable deps — fully unit-testable)
// ---------------------------------------------------------------------------

export type UpgradeResult =
  | { status: "already-latest"; version: string }
  | { status: "upgraded"; from: string; to: string }
  | { status: "dev-mode" }
  | { status: "error"; message: string };

/**
 * Main upgrade logic. All dependencies are injectable for unit testing.
 */
export async function runUpgrade(
  options: UpgradeOptions = {},
): Promise<UpgradeResult> {
  const execPath = options.execPath ?? process.execPath;

  // Dev-mode guard
  if (!isCompiledBinary(execPath)) {
    return { status: "dev-mode" };
  }

  const currentVersion =
    options.currentVersion ??
    // Dynamically import to get the live package version
    ((await import("../../package.json")).default as { version: string }).version;

  const fetchFn =
    options.fetchLatestVersion ?? fetchLatestVersionFromGitHub;
  const replaceFn =
    options.downloadAndReplace ?? downloadAndReplaceBinary;

  let latestTag: string;
  try {
    latestTag = await fetchFn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", message: `Failed to check for updates: ${msg}` };
  }

  // Normalise: strip leading "v" for comparison
  const latestVersion = latestTag.replace(/^v/, "");

  const cmp = semverCompare(latestVersion, currentVersion);

  if (cmp === 0) {
    return { status: "already-latest", version: currentVersion };
  }

  // Current binary is already newer than the latest release (e.g., pre-release
  // build). Treat as up-to-date rather than downgrading.
  if (cmp === -1) {
    return { status: "already-latest", version: currentVersion };
  }

  try {
    await replaceFn(latestTag, execPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", message: `Upgrade failed: ${msg}` };
  }

  return { status: "upgraded", from: currentVersion, to: latestVersion };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * CLI handler for `see-crets upgrade`.
 */
export async function runUpgradeCommand(): Promise<void> {
  const result = await runUpgrade();

  switch (result.status) {
    case "dev-mode":
      process.stdout.write(
        "upgrade is not supported in dev mode\n",
      );
      process.exit(1);
      break;

    case "already-latest":
      process.stdout.write(`Already on latest (v${result.version})\n`);
      break;

    case "upgraded":
      process.stdout.write(`Upgraded v${result.from} → v${result.to}\n`);
      break;

    case "error":
      process.stderr.write(`${result.message}\n`);
      process.exit(1);
      break;
  }
}
