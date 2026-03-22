import { describe, it, expect } from "bun:test";
import { scrub, REDACTED, MIN_SECRET_LENGTH } from "./scrub.ts";

describe("scrub", () => {
  it("replaces a secret value with [REDACTED]", () => {
    const result = scrub("The token is ghp_supersecret123.", ["ghp_supersecret123"]);
    expect(result).toBe(`The token is ${REDACTED}.`);
    expect(result).not.toContain("ghp_supersecret123");
  });

  it("replaces all occurrences, not just the first", () => {
    const secret = "repeatvalue99";
    const output = `first: ${secret}, second: ${secret}, third: ${secret}`;
    const result = scrub(output, [secret]);
    expect(result.split(REDACTED)).toHaveLength(4); // 3 replacements = 4 parts
    expect(result).not.toContain(secret);
  });

  it("scrubs a secret embedded inside a JSON blob", () => {
    const secret = "supersecretjsonval";
    const output = JSON.stringify({ token: secret, status: "ok" });
    const result = scrub(output, [secret]);
    expect(result).not.toContain(secret);
    expect(result).toContain(REDACTED);
  });

  it("scrubs a secret embedded inside a URL", () => {
    const secret = "urlsecret_xyz987";
    const output = `https://api.example.com/hook?token=${secret}&other=val`;
    const result = scrub(output, [secret]);
    expect(result).not.toContain(secret);
    expect(result).toContain(REDACTED);
  });

  it("does NOT redact values shorter than MIN_SECRET_LENGTH chars", () => {
    const shortSecret = "abc"; // 3 chars < 8
    const output = `result: abc value`;
    const result = scrub(output, [shortSecret]);
    // Short values must not be redacted to avoid false positives
    expect(result).toBe(output);
  });

  it(`does NOT redact values of exactly ${MIN_SECRET_LENGTH - 1} chars`, () => {
    const borderline = "a".repeat(MIN_SECRET_LENGTH - 1);
    const output = `data: ${borderline} end`;
    expect(scrub(output, [borderline])).toBe(output);
  });

  it(`DOES redact values of exactly ${MIN_SECRET_LENGTH} chars`, () => {
    const exactLen = "a".repeat(MIN_SECRET_LENGTH);
    const output = `data: ${exactLen} end`;
    const result = scrub(output, [exactLen]);
    expect(result).not.toContain(exactLen);
    expect(result).toContain(REDACTED);
  });

  it("handles multiple different secrets in one pass", () => {
    const secrets = ["ghp_supersecret123", "npm_topsecretabc"];
    const output = `token=${secrets[0]} npm=${secrets[1]}`;
    const result = scrub(output, secrets);
    for (const s of secrets) {
      expect(result).not.toContain(s);
    }
  });

  it("handles secrets containing regex special characters", () => {
    // These chars would break a naive unescaped regex
    const secret = "p@$$w0rd.+*[secret]";
    const output = `password is p@$$w0rd.+*[secret] now`;
    const result = scrub(output, [secret]);
    expect(result).not.toContain(secret);
    expect(result).toContain(REDACTED);
  });

  it("fully redacts a longer secret even when a shorter prefix-secret is also present", () => {
    // If processed short-first, "secret12" matches inside "secret123456789",
    // replacing it with [REDACTED], leaving "3456789" exposed.
    // Sorted longest-first avoids this entirely.
    const shorter = "secret12";          // 8 chars — above threshold
    const longer  = "secret123456789";   // 15 chars
    const output  = `token=${longer}`;

    const result = scrub(output, [shorter, longer]);
    expect(result).not.toContain(longer);
    expect(result).not.toContain(shorter);
    // Should be fully replaced by a single [REDACTED], not [REDACTED]3456789
    expect(result).toBe(`token=${REDACTED}`);
  });

  it("returns output unchanged when secrets array is empty", () => {
    const output = "nothing to scrub here";
    expect(scrub(output, [])).toBe(output);
  });

  it("returns output unchanged when no secret appears in output", () => {
    const output = "no match in this text";
    const result = scrub(output, ["somesecretvalue123"]);
    expect(result).toBe(output);
  });
});
