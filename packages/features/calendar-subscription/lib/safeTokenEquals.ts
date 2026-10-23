import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time compare for webhook shared secrets (Graph clientState). Both sides are hashed
 * first so neither the content nor the length of the expected token leaks through timing.
 */
export function safeTokenEquals(candidate: unknown, expected: string | null | undefined): boolean {
  if (!expected || typeof candidate !== "string") return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
