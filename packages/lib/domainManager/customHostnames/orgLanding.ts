/**
 * WC-TW-12f: data for the org landing page at /team/<orgSlug> (the custom-host root rewrite target,
 * see hostRouting.orgRootRewritePath). Pure: the Prisma side lives in OrgLandingRepository.
 *
 * Only members that pass the same check the custom-host resolver applies to /:user (12c2) are
 * listed: every user row carrying that username belongs to this org. A member whose username also
 * exists in another org is left out, because the link would be refused on the custom host and, on
 * the platform host, could open the other tenant's page. No email or other contact field is read.
 */

export interface OrgLandingPort {
  /** Only status=active Timeway orgs. */
  findActiveOrgBySlug(slug: string): Promise<{
    id: string;
    slug: string;
    name: string;
    logoUrl: string | null;
    brand: unknown;
  } | null>;
  /** Users whose twOrgId is this org (bounded). */
  listOrgUsers(
    orgId: string
  ): Promise<{ id: number; username: string | null; name: string | null; locked: boolean }[]>;
  /** Every user row carrying one of these usernames, with its Timeway org (same as the resolver port). */
  listUsersByUsername(usernames: string[]): Promise<{ username: string; twOrgId: string | null }[]>;
  /** Personal (non-team), non-hidden event types of these users, ordered for display. */
  listPublicEventTypes(
    userIds: number[]
  ): Promise<{ userId: number; slug: string; title: string; length: number; twOrgId: string | null }[]>;
  /** Non-hidden event types of every team whose slug equals this org slug (case-insensitive). */
  listTeamEventTypesBySlug(slug: string): Promise<
    {
      teamId: number;
      teamSlug: string;
      slug: string;
      title: string;
      length: number;
      twOrgId: string | null;
      managed: boolean;
    }[]
  >;
}

export type OrgLandingLink = { title: string; length: number; href: string };
export type OrgLandingMember = { name: string; username: string; href: string; links: OrgLandingLink[] };
export type OrgLanding = {
  org: { slug: string; name: string; logoUrl: string | null; accentColor: string | null };
  /** The org's own team links (/team/<orgSlug>/<type>). */
  teamLinks: OrgLandingLink[];
  members: OrgLandingMember[];
};

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const ORG_LANDING_MAX_MEMBERS = 50;

/** Logo must be https or a same-origin path; anything else (javascript:, data:, http:) is dropped. */
export function safeLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const value = url.trim();
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** tw_organization.brand is free JSON; only a hex primary/brand colour is used. */
export function accentColorFromBrand(brand: unknown): string | null {
  if (!brand || typeof brand !== "object" || Array.isArray(brand)) return null;
  const b = brand as Record<string, unknown>;
  for (const key of ["primaryColor", "brandColor", "color"]) {
    const v = b[key];
    if (typeof v === "string" && HEX_RE.test(v.trim())) return v.trim();
  }
  return null;
}

/**
 * A team whose slug is the org slug is the org's own team (the resolver's first "owned" rule).
 * Listed only when exactly one team carries the slug, because /team/<slug>/<type> picks by slug and
 * every event must be this org's; managed parents are not bookable pages.
 */
async function loadTeamLinks(
  port: OrgLandingPort,
  org: { id: string; slug: string }
): Promise<OrgLandingLink[]> {
  const rows = await port.listTeamEventTypesBySlug(org.slug);
  if (!rows.length) return [];
  const teamIds = new Set(rows.map((r) => r.teamId));
  if (teamIds.size !== 1) return [];
  if (!rows.every((r) => r.twOrgId === org.id)) return [];
  const base = `/team/${encodeURIComponent(org.slug)}`;
  return rows
    .filter((r) => !r.managed && SLUG_RE.test(r.slug))
    .map((r) => ({ title: r.title, length: r.length, href: `${base}/${encodeURIComponent(r.slug)}` }));
}

export async function loadOrgLanding(port: OrgLandingPort, rawSlug: string): Promise<OrgLanding | null> {
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug).trim().toLowerCase();
  } catch {
    return null;
  }
  if (!SLUG_RE.test(slug)) return null;

  const org = await port.findActiveOrgBySlug(slug);
  if (!org) return null;

  const users = (await port.listOrgUsers(org.id))
    .filter((u): u is typeof u & { username: string } => !!u.username && !u.locked)
    .filter((u) => SLUG_RE.test(u.username))
    .slice(0, ORG_LANDING_MAX_MEMBERS);

  let members: OrgLandingMember[] = [];
  if (users.length) {
    const rows = await port.listUsersByUsername(users.map((u) => u.username.toLowerCase()));
    const passes = (username: string) => {
      const matches = rows.filter((r) => r.username.toLowerCase() === username.toLowerCase());
      return matches.length > 0 && matches.every((r) => r.twOrgId === org.id);
    };
    const eligible = users.filter((u) => passes(u.username));

    const events = eligible.length ? await port.listPublicEventTypes(eligible.map((u) => u.id)) : [];
    members = eligible
      .map((u) => {
        const base = `/${encodeURIComponent(u.username)}`;
        const links = events
          .filter((e) => e.userId === u.id && (e.twOrgId === null || e.twOrgId === org.id))
          .filter((e) => SLUG_RE.test(e.slug))
          .map((e) => ({ title: e.title, length: e.length, href: `${base}/${encodeURIComponent(e.slug)}` }));
        return { name: u.name?.trim() || u.username, username: u.username, href: base, links };
      })
      .filter((m) => m.links.length > 0);
  }

  return {
    teamLinks: await loadTeamLinks(port, org),
    org: {
      slug: org.slug,
      name: org.name,
      logoUrl: safeLogoUrl(org.logoUrl),
      accentColor: accentColorFromBrand(org.brand),
    },
    members,
  };
}
