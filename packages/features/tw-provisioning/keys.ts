/**
 * TW-T10 — org API key + platform master key verification (TW-23: prefix-identified,
 * hash-stored, constant-time compare; G-2 pattern).
 *
 * Org key format: `twk_<8 hex>.<48 hex>`. The prefix is stored in clear (unique), the
 * secret half only as sha256. Master key: env TW_PLATFORM_MASTER_KEY, org-create only.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import process from "node:process";

export const ORG_KEY_PREFIX_RE = /^twk_[0-9a-f]{8}$/;

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

export function safeEqualHex(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

export function generateOrgKey(): { prefix: string; raw: string; hashedKey: string } {
  const prefix = `twk_${randomBytes(4).toString("hex")}`;
  const raw = `${prefix}.${randomBytes(24).toString("hex")}`;
  return { prefix, raw, hashedKey: sha256Hex(raw) };
}

export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

export function isPlatformMasterKey(token: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = env.TW_PLATFORM_MASTER_KEY;
  if (!expected || expected.length < 24) return false;
  return safeEqualHex(token, expected);
}

export interface OrgKeyRow {
  id: string;
  orgId: string;
  hashedKey: string;
  scopes: string[];
  revokedAt: Date | null;
}

/** Split `prefix.secret`; null when the shape is wrong (never touches the DB). */
export function parseOrgKey(token: string): { prefix: string } | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const prefix = token.slice(0, dot);
  if (!ORG_KEY_PREFIX_RE.test(prefix)) return null;
  if (!/^[0-9a-f]{48}$/.test(token.slice(dot + 1))) return null;
  return { prefix };
}

/** Constant-time check of a presented token against the stored row. */
export function orgKeyMatches(token: string, row: Pick<OrgKeyRow, "hashedKey" | "revokedAt">): boolean {
  const ok = safeEqualHex(sha256Hex(token), row.hashedKey);
  return ok && !row.revokedAt;
}

export function hasScope(scopes: readonly string[], needed: string): boolean {
  return scopes.includes("*") || scopes.includes(needed);
}
