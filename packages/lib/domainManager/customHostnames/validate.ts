import { parse } from "tldts";

export type HostnameRejection =
  | "empty"
  | "too_long"
  | "not_a_hostname"
  | "wildcard"
  | "ip_address"
  | "unknown_suffix"
  | "apex_not_allowed"
  | "reserved_domain";

export type HostnameValidation = { ok: true; hostname: string } | { ok: false; reason: HostnameRejection };

// Our own zones: a tenant must never claim a host the platform already serves.
export const RESERVED_REGISTRABLE_DOMAINS = ["timeway.co", "spenai.net", "awstreams.co"];

const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Lowercase, trim, strip a single trailing dot. Used by the approval endpoint too, so both sides agree. */
export function normalizeHostname(input: string): string {
  const trimmed = input.trim().toLowerCase();
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
}

/**
 * D3: subdomains only (book.acme.com, never acme.com), public ICANN suffix,
 * no IPs, no wildcards, nothing under our own zones.
 */
export function validateCustomHostname(input: string): HostnameValidation {
  const hostname = normalizeHostname(input);
  if (!hostname) return { ok: false, reason: "empty" };
  if (hostname.length > 253) return { ok: false, reason: "too_long" };
  if (hostname.includes("*")) return { ok: false, reason: "wildcard" };

  const parsed = parse(hostname, { allowPrivateDomains: true });
  if (parsed.isIp) return { ok: false, reason: "ip_address" };

  const labels = hostname.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL_RE.test(label))) {
    return { ok: false, reason: "not_a_hostname" };
  }
  if (parsed.hostname !== hostname) return { ok: false, reason: "not_a_hostname" };
  if (!parsed.isIcann || !parsed.domain) return { ok: false, reason: "unknown_suffix" };

  const registrable = parse(hostname).domain;
  if (registrable && RESERVED_REGISTRABLE_DOMAINS.includes(registrable)) {
    return { ok: false, reason: "reserved_domain" };
  }
  if (!parsed.subdomain) return { ok: false, reason: "apex_not_allowed" };

  return { ok: true, hostname };
}
