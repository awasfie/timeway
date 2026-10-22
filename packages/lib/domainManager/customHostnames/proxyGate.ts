import process from "node:process";
import {
  classifyCustomHostPath,
  hostFromHeader,
  hostOfUrl,
  isPlatformHost,
  orgRootRewritePath,
} from "./hostRouting";
import { createResolveCache } from "./resolve";
import { APPROVE_SECRET_HEADER } from "./service";

export type CustomHostDecision =
  /** Not a customer host (or flag off on a platform host): today's behaviour. */
  | { action: "next" }
  /** Customer host, allowed path, no rewrite needed. */
  | { action: "serve" }
  | { action: "rewrite"; pathname: string; search: string }
  | { action: "notFound" };

export type Resolver = (query: {
  host: string;
  users?: string[];
  team?: string;
}) => Promise<{ orgSlug: string } | null>;

type GateEnv = {
  enabled: boolean;
  ownHosts: string[];
};

export function readGateEnv(): GateEnv {
  const ownHosts = [
    hostOfUrl(process.env.NEXT_PUBLIC_WEBAPP_URL),
    hostOfUrl(process.env.NEXT_PUBLIC_WEBSITE_URL),
    hostOfUrl(process.env.NEXTAUTH_URL),
    ...(process.env.ALLOWED_HOSTNAMES ?? "").split(",").map((h) => hostFromHeader(h.replace(/["']/g, ""))),
  ].filter(Boolean);
  return { enabled: process.env.TW_CUSTOM_DOMAINS_ENABLED === "true", ownHosts };
}

/**
 * WC-TW-12c2: decide what proxy.ts does with a request. Platform hosts always get "next" so the
 * flag-off path and every *.timeway.co request behave exactly as before this change.
 */
export async function decideCustomHost(
  input: { hostHeader: string | null; pathname: string; search: string },
  env: GateEnv,
  resolve: Resolver
): Promise<CustomHostDecision> {
  const host = hostFromHeader(input.hostHeader);
  if (isPlatformHost(host, env.ownHosts)) return { action: "next" };
  if (!env.enabled) return { action: "notFound" };

  const route = classifyCustomHostPath(input.pathname);
  if (route.kind === "deny") return { action: "notFound" };

  const query =
    route.kind === "user"
      ? { host, users: route.slugs }
      : route.kind === "team"
        ? { host, team: route.slug }
        : { host };
  const resolved = await resolve(query);
  if (!resolved) return { action: "notFound" };

  if (route.kind === "root") {
    const target = orgRootRewritePath(resolved.orgSlug, route.embed);
    const [pathname, search = ""] = target.split("?");
    const merged = new URLSearchParams(input.search);
    new URLSearchParams(search).forEach((v, k) => merged.set(k, v));
    const qs = merged.toString();
    return { action: "rewrite", pathname, search: qs ? `?${qs}` : "" };
  }
  return { action: "serve" };
}

const cache = createResolveCache<{ orgSlug: string } | null>();

/** Test hook: the cache is per process; tests reset it between cases. */
export function clearCustomHostCache() {
  cache.clear();
}

function cacheKey(q: { host: string; users?: string[]; team?: string }) {
  return `${q.host}|u:${(q.users ?? []).join("+")}|t:${q.team ?? ""}`;
}

/**
 * Fetches /api/internal/custom-domain/resolve on this same instance (proxy.ts must not load Prisma).
 * Positive and negative answers are cached 60 s; transport errors are not cached and fail closed.
 */
export function createHttpResolver(fetchImpl: typeof fetch = fetch): Resolver {
  return async (q) => {
    const key = cacheKey(q);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    const secret = process.env.TW_DOMAIN_APPROVE_SECRET;
    if (!secret) return null;
    const base = process.env.TW_INTERNAL_APP_URL || `http://127.0.0.1:${process.env.PORT || "3000"}`;
    const url = new URL("/api/internal/custom-domain/resolve", base);
    url.searchParams.set("host", q.host);
    if (q.users?.length) url.searchParams.set("users", q.users.join(","));
    if (q.team) url.searchParams.set("team", q.team);

    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { [APPROVE_SECRET_HEADER]: secret },
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
    } catch {
      return null;
    }
    if (res.status === 404) {
      cache.set(key, null);
      return null;
    }
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { orgSlug?: unknown } | null;
    if (!body || typeof body.orgSlug !== "string" || !body.orgSlug) return null;
    const value = { orgSlug: body.orgSlug };
    cache.set(key, value);
    return value;
  };
}
