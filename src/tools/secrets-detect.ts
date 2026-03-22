import { detectResult } from "../vault/detect.ts";
import type { DetectResult } from "../vault/types.ts";

/**
 * Reports the active OS vault backend and its health status.
 * Safe to expose to the LLM — returns no secret values.
 */
export async function secretsDetect(): Promise<DetectResult> {
  return detectResult();
}
