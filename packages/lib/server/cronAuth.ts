import { createHash, timingSafeEqual } from "node:crypto";
import process from "node:process";

type CronRequest = {
  headers: { get(name: string): string | null };
  url: string;
};

type CronAuthOptions = {
  /** Accept the raw CRON_API_KEY value (header or apiKey query param). */
  allowApiKey?: boolean;
  /** Accept `Bearer ${CRON_SECRET}` (header or apiKey query param). */
  allowBearerSecret?: boolean;
  /** Read the presented credential from the `apiKey` query param when no authorization header is sent. */
  allowQueryParam?: boolean;
};

const nonEmpty = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

// Digesting both sides first gives equal-length buffers, so timingSafeEqual never throws
// and the comparison does not leak the expected secret's length.
const safeEqual = (a: string, b: string): boolean =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

/**
 * Only env vars that are set contribute a candidate; interpolating an unset CRON_SECRET
 * would otherwise make the literal "Bearer undefined" a valid credential.
 */
export function getCronCredentialCandidates({
  allowApiKey = true,
  allowBearerSecret = true,
}: CronAuthOptions = {}): string[] {
  const candidates: string[] = [];
  const apiKey = process.env.CRON_API_KEY;
  const secret = process.env.CRON_SECRET;
  if (allowApiKey && nonEmpty(apiKey)) candidates.push(apiKey);
  if (allowBearerSecret && nonEmpty(secret)) candidates.push(`Bearer ${secret}`);
  return candidates;
}

export function isCronCredentialValid(
  presented: string | null | undefined,
  options?: CronAuthOptions
): boolean {
  if (!nonEmpty(presented)) return false;
  // Evaluate every candidate so timing does not reveal which one matched.
  return getCronCredentialCandidates(options).reduce(
    (matched, candidate) => safeEqual(presented, candidate) || matched,
    false
  );
}

export function isCronAuthorized(req: CronRequest, options: CronAuthOptions = {}): boolean {
  const { allowQueryParam = true } = options;
  let presented = req.headers.get("authorization");
  if (!presented && allowQueryParam) {
    presented = new URL(req.url).searchParams.get("apiKey");
  }
  return isCronCredentialValid(presented, options);
}
