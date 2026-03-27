import { describe, it, expect, spyOn, afterEach } from "bun:test";
import {
  isMusl,
  getAssetName,
  parseChecksums,
  semverCompare,
  runUpgrade,
  type UpgradeOptions,
} from "./upgrade-command.ts";

// ---------------------------------------------------------------------------
// semverCompare
// ---------------------------------------------------------------------------

describe("semverCompare", () => {
  it("returns 0 for equal versions", () => {
    expect(semverCompare("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns 1 when a > b (major)", () => {
    expect(semverCompare("2.0.0", "1.9.9")).toBe(1);
  });

  it("returns 1 when a > b (minor)", () => {
    expect(semverCompare("1.3.0", "1.2.9")).toBe(1);
  });

  it("returns 1 when a > b (patch)", () => {
    expect(semverCompare("1.2.4", "1.2.3")).toBe(1);
  });

  it("returns -1 when a < b (major)", () => {
    expect(semverCompare("0.9.0", "1.0.0")).toBe(-1);
  });

  it("returns -1 when a < b (minor)", () => {
    expect(semverCompare("1.1.9", "1.2.0")).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// getAssetName — platform/arch mapping
// ---------------------------------------------------------------------------

describe("getAssetName", () => {
  it("returns darwin-arm64 asset", () => {
    expect(getAssetName("darwin", "arm64", false)).toBe("see-crets-darwin-arm64");
  });

  it("returns darwin-x64 asset", () => {
    expect(getAssetName("darwin", "x64", false)).toBe("see-crets-darwin-x64");
  });

  it("returns linux-x64 asset", () => {
    expect(getAssetName("linux", "x64", false)).toBe("see-crets-linux-x64");
  });

  it("returns linux-arm64 asset", () => {
    expect(getAssetName("linux", "arm64", false)).toBe("see-crets-linux-arm64");
  });

  it("returns linux-x64-musl asset on Alpine", () => {
    expect(getAssetName("linux", "x64", true)).toBe("see-crets-linux-x64-musl");
  });

  it("returns linux-arm64-musl asset on Alpine arm", () => {
    expect(getAssetName("linux", "arm64", true)).toBe("see-crets-linux-arm64-musl");
  });

  it("returns windows-x64.exe asset", () => {
    expect(getAssetName("win32", "x64", false)).toBe("see-crets-windows-x64.exe");
  });

  it("throws for unsupported macOS arch", () => {
    expect(() => getAssetName("darwin", "ia32", false)).toThrow(
      "Unsupported architecture on macOS: ia32",
    );
  });

  it("throws for unsupported Linux arch", () => {
    expect(() => getAssetName("linux", "ia32", false)).toThrow(
      "Unsupported architecture on Linux: ia32",
    );
  });

  it("throws for unsupported Windows arch", () => {
    expect(() => getAssetName("win32", "arm64", false)).toThrow(
      "Unsupported architecture on Windows: arm64",
    );
  });

  it("throws for unsupported platform", () => {
    expect(() => getAssetName("freebsd", "x64", false)).toThrow(
      "Unsupported platform: freebsd",
    );
  });
});

// ---------------------------------------------------------------------------
// parseChecksums
// ---------------------------------------------------------------------------

describe("parseChecksums", () => {
  const CHECKSUMS = `
abc123def456abc123def456abc123def456abc123def456abc123def456abc12345  see-crets-darwin-arm64
deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  see-crets-linux-x64
aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd  see-crets-windows-x64.exe
`.trim();

  it("finds a hash by filename", () => {
    const hash = parseChecksums(CHECKSUMS, "see-crets-linux-x64");
    expect(hash).toBe("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
  });

  it("returns undefined for unknown filename", () => {
    expect(parseChecksums(CHECKSUMS, "see-crets-unknown")).toBeUndefined();
  });

  it("handles asterisk-prefixed filenames (BSD checksum style)", () => {
    const content =
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef *see-crets-linux-x64";
    expect(parseChecksums(content, "see-crets-linux-x64")).toBe(
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    );
  });

  it("returns undefined on empty content", () => {
    expect(parseChecksums("", "see-crets-linux-x64")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runUpgrade — already latest
// ---------------------------------------------------------------------------

describe("runUpgrade — already latest", () => {
  it("returns already-latest when versions match", async () => {
    const opts: UpgradeOptions = {
      execPath: "/usr/local/bin/see-crets",
      currentVersion: "0.1.0",
      fetchLatestVersion: async () => "v0.1.0",
    };

    const result = await runUpgrade(opts);

    expect(result.status).toBe("already-latest");
    if (result.status === "already-latest") {
      expect(result.version).toBe("0.1.0");
    }
  });

  it("strips leading 'v' when comparing versions", async () => {
    const opts: UpgradeOptions = {
      execPath: "/usr/local/bin/see-crets",
      currentVersion: "1.2.3",
      fetchLatestVersion: async () => "v1.2.3",
    };

    const result = await runUpgrade(opts);
    expect(result.status).toBe("already-latest");
  });

  it("returns already-latest when current version is AHEAD of latest (prevents downgrade)", async () => {
    const opts: UpgradeOptions = {
      execPath: "/usr/local/bin/see-crets",
      currentVersion: "0.3.0",
      fetchLatestVersion: async () => "v0.2.0",
    };
    const result = await runUpgrade(opts);
    expect(result.status).toBe("already-latest");
  });
});

// ---------------------------------------------------------------------------
// runUpgrade — newer version available
// ---------------------------------------------------------------------------

describe("runUpgrade — upgrade available", () => {
  it("calls downloadAndReplace with correct tag and execPath", async () => {
    const calls: Array<{ tag: string; execPath: string }> = [];

    const opts: UpgradeOptions = {
      execPath: "/usr/local/bin/see-crets",
      currentVersion: "0.1.0",
      fetchLatestVersion: async () => "v0.2.0",
      downloadAndReplace: async (tag, execPath) => {
        calls.push({ tag, execPath });
      },
    };

    const result = await runUpgrade(opts);

    expect(result.status).toBe("upgraded");
    if (result.status === "upgraded") {
      expect(result.from).toBe("0.1.0");
      expect(result.to).toBe("0.2.0");
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].tag).toBe("v0.2.0");
    expect(calls[0].execPath).toBe("/usr/local/bin/see-crets");
  });

  it("returns error when downloadAndReplace throws", async () => {
    const opts: UpgradeOptions = {
      execPath: "/usr/local/bin/see-crets",
      currentVersion: "0.1.0",
      fetchLatestVersion: async () => "v0.2.0",
      downloadAndReplace: async () => {
        throw new Error("disk full");
      },
    };

    const result = await runUpgrade(opts);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("disk full");
    }
  });
});

// ---------------------------------------------------------------------------
// runUpgrade — network / API errors
// ---------------------------------------------------------------------------

describe("runUpgrade — error handling", () => {
  it("returns error result when fetchLatestVersion throws (network failure)", async () => {
    const opts: UpgradeOptions = {
      execPath: "/usr/local/bin/see-crets",
      currentVersion: "0.1.0",
      fetchLatestVersion: async () => {
        throw new Error("ENOTCONN: network is unreachable");
      },
    };

    const result = await runUpgrade(opts);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("ENOTCONN");
      expect(result.message).toContain("Failed to check for updates");
    }
  });

  it("returns error result when API returns non-200", async () => {
    const opts: UpgradeOptions = {
      execPath: "/usr/local/bin/see-crets",
      currentVersion: "0.1.0",
      fetchLatestVersion: async () => {
        throw new Error("GitHub API returned 403 Forbidden");
      },
    };

    const result = await runUpgrade(opts);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("403");
    }
  });
});

// ---------------------------------------------------------------------------
// runUpgrade — dev mode
// ---------------------------------------------------------------------------

describe("runUpgrade — dev mode", () => {
  it("returns dev-mode when execPath is the bun runtime", async () => {
    const opts: UpgradeOptions = {
      execPath: "/usr/local/bin/bun",
      currentVersion: "0.1.0",
      fetchLatestVersion: async () => "v0.2.0",
    };

    const result = await runUpgrade(opts);

    expect(result.status).toBe("dev-mode");
  });

  it("returns dev-mode when execPath is bun.exe", async () => {
    const opts: UpgradeOptions = {
      execPath: "C:\\bun\\bun.exe",
      currentVersion: "0.1.0",
      fetchLatestVersion: async () => "v0.2.0",
    };

    const result = await runUpgrade(opts);

    expect(result.status).toBe("dev-mode");
  });

  it("returns dev-mode when execPath is the node runtime", async () => {
    const opts: UpgradeOptions = {
      execPath: "/usr/bin/node",
      currentVersion: "0.1.0",
      fetchLatestVersion: async () => "v0.2.0",
    };

    const result = await runUpgrade(opts);

    expect(result.status).toBe("dev-mode");
  });

  it("does NOT call fetchLatestVersion in dev mode (no network attempt)", async () => {
    let called = false;
    const opts: UpgradeOptions = {
      execPath: "/usr/local/bin/bun",
      currentVersion: "0.1.0",
      fetchLatestVersion: async () => {
        called = true;
        return "v0.2.0";
      },
    };

    await runUpgrade(opts);

    expect(called).toBe(false);
  });
});
