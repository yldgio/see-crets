import { describe, it, expect } from "bun:test";
import pkg from "../package.json";

async function runCli(...args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), exitCode };
}

describe("CLI --version / -v", () => {
  it("--version prints 'see-crets <version>' and exits 0", async () => {
    const { stdout, exitCode } = await runCli("--version");
    expect(exitCode).toBe(0);
    expect(stdout).toBe(`see-crets ${pkg.version}`);
  });

  it("-v is an alias for --version", async () => {
    const { stdout, exitCode } = await runCli("-v");
    expect(exitCode).toBe(0);
    expect(stdout).toBe(`see-crets ${pkg.version}`);
  });

  it("version string matches package.json at build time", async () => {
    const { stdout } = await runCli("--version");
    expect(stdout).toContain(pkg.version);
  });
});
