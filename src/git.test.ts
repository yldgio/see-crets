import { describe, it, expect } from "bun:test";
import { getProjectName, isInGitRepo } from "./utils/git.ts";

// ---------------------------------------------------------------------------
// Real system behavior — no mocking needed (we're running in a git repo)
// ---------------------------------------------------------------------------
// Note: spawner-injection edge cases (non-repo, throws) are covered indirectly by
// secrets-list.test.ts which mocks git.ts itself for global-fallback tests.
// ---------------------------------------------------------------------------

describe("getProjectName", () => {
  it("returns a non-empty string when inside a git repo", () => {
    const name = getProjectName();
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  it("returns the actual git root basename (see-crets)", () => {
    // Tests run from the see-crets repo — the basename should match the folder name.
    expect(getProjectName()).toBe("see-crets");
  });

  it("spawner override: returns basename from injected path", () => {
    // Verify the spawner parameter is honoured when the real git is bypassed.
    const fakeSpawner = (_cmd: string[]) => ({
      exitCode: 0 as const,
      stdout: Buffer.from("/home/user/injected-project\n"),
    });
    expect(getProjectName(fakeSpawner)).toBe("injected-project");
  });

  it("spawner override: returns 'global' on non-zero exit code", () => {
    const failingSpawner = (_cmd: string[]) => ({
      exitCode: 128 as const,
      stdout: Buffer.from(""),
    });
    expect(getProjectName(failingSpawner)).toBe("global");
  });

  it("spawner override: returns 'global' when spawner throws", () => {
    const throwingSpawner = (_cmd: string[]): never => {
      throw new Error("git not found");
    };
    expect(getProjectName(throwingSpawner)).toBe("global");
  });
});

describe("isInGitRepo", () => {
  it("returns true when inside a git repo", () => {
    expect(isInGitRepo()).toBe(true);
  });

  it("spawner override: returns false on non-zero exit code", () => {
    const failingSpawner = (_cmd: string[]) => ({
      exitCode: 128 as const,
      stdout: Buffer.from(""),
    });
    expect(isInGitRepo(failingSpawner)).toBe(false);
  });

  it("spawner override: returns false when spawner throws", () => {
    const throwingSpawner = (_cmd: string[]): never => {
      throw new Error("git not found");
    };
    expect(isInGitRepo(throwingSpawner)).toBe(false);
  });
});
