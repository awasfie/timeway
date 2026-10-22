import { normalizeHostname } from "./validate";

/** Cross-org, platform-context reads the resolve route needs. Implemented by CustomHostnameRepository. */
export interface CustomHostResolverPort {
  /** Only rows with status=active; pending_dns and failed return null. */
  findActiveOrgByHostname(hostname: string): Promise<{ orgId: string; orgSlug: string } | null>;
  /** Every user row carrying one of these usernames, with its Timeway org. */
  listUsersByUsername(usernames: string[]): Promise<{ username: string; twOrgId: string | null }[]>;
  /** Every team with this slug, with what ties it to an org. */
  listTeamsBySlug(slug: string): Promise<{ slug: string; parentSlug: string | null; eventTypeOrgIds: (string | null)[] }[]>;
}

export type ResolveRequest = { host: string; users?: string[]; team?: string };
export type ResolveResult = { ok: true; orgSlug: string } | { ok: false };

const DENY: ResolveResult = { ok: false };

/**
 * WC-TW-12c2: maps an ACTIVE customer host to its org and refuses any user/team slug that is not
 * wholly that org's. Slugs are not unique across orgs upstream, so one foreign match denies: the
 * page renders without org context and could otherwise pick the other tenant's row.
 */
export async function resolveCustomHost(
  port: CustomHostResolverPort,
  req: ResolveRequest
): Promise<ResolveResult> {
  const host = normalizeHostname(req.host);
  if (!host || host.length > 253) return DENY;
  const org = await port.findActiveOrgByHostname(host);
  if (!org) return DENY;

  if (req.users?.length) {
    const wanted = Array.from(new Set(req.users.map((u) => u.toLowerCase())));
    const rows = await port.listUsersByUsername(wanted);
    for (const username of wanted) {
      const matches = rows.filter((r) => r.username.toLowerCase() === username);
      if (!matches.length || matches.some((r) => r.twOrgId !== org.orgId)) return DENY;
    }
  }

  if (req.team) {
    const slug = req.team.toLowerCase();
    const teams = await port.listTeamsBySlug(slug);
    if (!teams.length) return DENY;
    const owned = (t: (typeof teams)[number]) =>
      t.slug.toLowerCase() === org.orgSlug.toLowerCase() ||
      t.parentSlug?.toLowerCase() === org.orgSlug.toLowerCase() ||
      (t.eventTypeOrgIds.length > 0 && t.eventTypeOrgIds.every((id) => id === org.orgId));
    if (!teams.every(owned)) return DENY;
  }

  return { ok: true, orgSlug: org.orgSlug };
}

export const RESOLVE_CACHE_TTL_MS = 60_000;
const RESOLVE_CACHE_MAX = 5_000;

/** Per-instance TTL cache; negative results are cached too so unknown hosts cannot hammer the DB. */
export function createResolveCache<V>(ttlMs = RESOLVE_CACHE_TTL_MS, now: () => number = Date.now) {
  const entries = new Map<string, { value: V; expiresAt: number }>();
  return {
    get(key: string): V | undefined {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: V) {
      if (entries.size >= RESOLVE_CACHE_MAX) entries.clear();
      entries.set(key, { value, expiresAt: now() + ttlMs });
    },
    clear() {
      entries.clear();
    },
  };
}
