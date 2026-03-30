/**
 * Scrub secret values from any string (tool output, logs, API responses) before
 * the content is returned to the LLM.
 *
 * Rules:
 *  - Only values with length >= MIN_SECRET_LENGTH are scrubbed (short strings cause
 *    false positives on common tokens and substrings).
 *  - Matching is case-sensitive and uses substring (not whole-word) matching, so a
 *    secret embedded inside a JSON blob or URL is still redacted.
 *  - All occurrences in `output` are replaced, not just the first.
 *  - Regex special characters inside the secret value are escaped before matching.
 */
export const REDACTED = "[REDACTED]";

/**
 * Minimum secret length for scrubbing. Secrets shorter than this value are
 * intentionally NOT scrubbed to avoid false positives on common short strings.
 *
 * ⚠  Operators should be aware: any vault secret whose value is shorter than
 * this threshold will appear verbatim in tool output returned to the LLM.
 * A warning is emitted at store-time (see ask-secret-set.ts).
 */
export const MIN_SECRET_LENGTH = 8;

/**
 * Escape every character that has special meaning in a JS regex literal.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace all occurrences of each secret value in `output` with `[REDACTED]`.
 *
 * Short secrets (below MIN_SECRET_LENGTH) are intentionally skipped to avoid
 * false positives — common short strings would produce noisy, broken output.
 * Operators should store only secrets that are at least MIN_SECRET_LENGTH characters
 * long if they require redaction; shorter values will appear verbatim in LLM output.
 *
 * @param output  The raw string to scrub (e.g. subprocess stdout/stderr).
 * @param secrets The resolved secret values to search for. Order does not matter.
 * @returns       The scrubbed string, safe to return to the LLM.
 */
export function scrub(output: string, secrets: string[]): string {
  let result = output;
  // Sort longest-first so a secret that is a prefix of a longer one does not
  // partially destroy the longer match before it can be applied.
  const sorted = [...secrets].sort((a, b) => b.length - a.length);
  for (const secret of sorted) {
    if (secret.length < MIN_SECRET_LENGTH) continue;
    const pattern = new RegExp(escapeRegex(secret), "g");
    result = result.replace(pattern, REDACTED);
  }
  return result;
}
