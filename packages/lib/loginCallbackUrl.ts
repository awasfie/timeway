import { WEBAPP_URL } from "@calcom/lib/constants";
import { getSafeRedirectUrl } from "@calcom/lib/getSafeRedirectUrl";

/** Where a login lands when no deeper callback was asked for. Never "/": since the path split, / on timeway.co is the marketing site. */
export const DEFAULT_LOGIN_LANDING_PATH = "/event-types";

const isBareRoot = (u: URL) =>
  u.pathname.replace(/\/+$/, "") === "" || /^\/[a-z]{2}(-[A-Za-z]{2})?$/.test(u.pathname.replace(/\/+$/, ""));

/**
 * Post-login destination. Accepts a raw callbackUrl (relative or absolute, may be empty), makes it absolute on WEBAPP_URL,
 * runs it through getSafeRedirectUrl (open-redirect guard) and rewrites a bare "/" (or "/ar") to /event-types.
 */
export function resolveLoginCallbackUrl(raw: string | null | undefined): string {
  let cb = raw || "";
  if (/"\//.test(cb)) cb = cb.substring(1);
  if (!/^https?:\/\//.test(cb)) cb = `${WEBAPP_URL}/${cb.replace(/^\/+/, "")}`;
  const safe = getSafeRedirectUrl(cb) || `${WEBAPP_URL}/`;
  const parsed = new URL(safe);
  if (isBareRoot(parsed) && !parsed.search.includes("="))
    return `${parsed.origin}${DEFAULT_LOGIN_LANDING_PATH}`;
  return safe;
}
