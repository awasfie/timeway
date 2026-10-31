/**
 * TW-T13 — org branding (logo + colours) for the public booking pages.
 * Source of truth: tw_organization.logoUrl + tw_organization.brand ({ brandColor, darkBrandColor }).
 * Untrusted input is validated here; the public page resolves the org from the event row's twOrgId
 * (never from the request), so one org cannot render another org's brand.
 */

import process from "node:process";
import { withTwOrg } from "@calcom/prisma/tw-org-context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export interface OrgBranding {
  logoUrl: string | null;
  brandColor: string | null;
  darkBrandColor: string | null;
  name: string | null;
}

export interface BrandingChange {
  logoUrl?: string | null;
  brandColor?: string | null;
  darkBrandColor?: string | null;
}

/** Hosts the booking-assets bucket is served from (comma list in TW_BOOKING_ASSETS_HOSTS). Unset = no logo accepted. */
export function allowedAssetHosts(env: Record<string, string | undefined> = process.env): string[] {
  return (env.TW_BOOKING_ASSETS_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedLogoUrl(raw: string, hosts: string[]): boolean {
  if (raw.length > 500) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === "https:" && !u.username && !u.password && hosts.includes(u.hostname.toLowerCase());
}

/** Body: { logo_url?, brand_color?, dark_brand_color? }; null clears a field. */
export function parseBrandingBody(
  body: unknown,
  hosts: string[] = allowedAssetHosts()
): BrandingChange | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  const out: BrandingChange = {};
  const color = (key: string, field: "brandColor" | "darkBrandColor") => {
    if (b[key] === undefined) return null;
    if (b[key] === null) {
      out[field] = null;
      return null;
    }
    if (typeof b[key] !== "string" || !HEX.test(b[key] as string))
      return `${key} must be a hex colour like #1a73e8`;
    out[field] = (b[key] as string).toLowerCase();
    return null;
  };
  const e1 = color("brand_color", "brandColor");
  if (e1) return { error: e1 };
  const e2 = color("dark_brand_color", "darkBrandColor");
  if (e2) return { error: e2 };
  if (b.logo_url !== undefined) {
    if (b.logo_url === null) out.logoUrl = null;
    else if (typeof b.logo_url !== "string" || !isAllowedLogoUrl(b.logo_url, hosts))
      return { error: "logo_url must be an https URL on the booking-assets host" };
    else out.logoUrl = b.logo_url;
  }
  if (Object.keys(out).length === 0) return { error: "nothing to change" };
  return out;
}

function brandJson(v: unknown): { brandColor?: string; darkBrandColor?: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const pick = (x: unknown) => (typeof x === "string" && HEX.test(x) ? x : undefined);
  return { brandColor: pick(o.brandColor), darkBrandColor: pick(o.darkBrandColor) };
}

export async function getOrgBranding(client: Any, orgId: string): Promise<OrgBranding | null> {
  return withTwOrg(client, orgId, async (tx: Any) => {
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: { name: true, logoUrl: true, brand: true, status: true },
    });
    if (!org) return null;
    const b = brandJson(org.brand);
    return {
      name: org.name ?? null,
      logoUrl: org.logoUrl ?? null,
      brandColor: b.brandColor ?? null,
      darkBrandColor: b.darkBrandColor ?? null,
    };
  });
}

export async function applyBranding(
  client: Any,
  orgId: string,
  change: BrandingChange
): Promise<OrgBranding | null> {
  return withTwOrg(client, orgId, async (tx: Any) => {
    const org = await tx.organization.findUnique({ where: { id: orgId }, select: { brand: true } });
    if (!org) return null;
    const brand = { ...brandJson(org.brand) } as Record<string, string | undefined>;
    if (change.brandColor !== undefined) brand.brandColor = change.brandColor ?? undefined;
    if (change.darkBrandColor !== undefined) brand.darkBrandColor = change.darkBrandColor ?? undefined;
    const data: Record<string, unknown> = { brand: JSON.parse(JSON.stringify(brand)) };
    if (change.logoUrl !== undefined) data.logoUrl = change.logoUrl;
    const row = await tx.organization.update({
      where: { id: orgId },
      data,
      select: { name: true, logoUrl: true, brand: true },
    });
    const b = brandJson(row.brand);
    return {
      name: row.name,
      logoUrl: row.logoUrl ?? null,
      brandColor: b.brandColor ?? null,
      darkBrandColor: b.darkBrandColor ?? null,
    };
  });
}

/** What the public page overlays on the event's profile/entity. Fields that are null keep the default look. */
export function overlayBranding<
  P extends { brandColor?: string | null; darkBrandColor?: string | null },
  E extends { logoUrl?: string | null; name?: string | null },
>(profile: P, entity: E, branding: OrgBranding | null): { profile: P; entity: E } {
  if (!branding) return { profile, entity };
  return {
    profile: {
      ...profile,
      brandColor: branding.brandColor ?? profile.brandColor,
      darkBrandColor: branding.darkBrandColor ?? profile.darkBrandColor,
    },
    entity: {
      ...entity,
      logoUrl: branding.logoUrl ?? entity.logoUrl,
      name: branding.name ?? entity.name,
    },
  };
}
