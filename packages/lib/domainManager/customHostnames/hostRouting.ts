/**
 * WC-TW-12c2: pure request classification for customer custom hostnames.
 * No I/O here so proxy.ts and the resolve route agree, and both are unit-testable.
 */

/** Platform zones a customer host can never be (mirrors RESERVED_REGISTRABLE_DOMAINS for the served zone). */
const PLATFORM_ZONES = ["timeway.co"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

/** Lowercase, drop the port, drop a trailing dot. */
export function hostFromHeader(hostHeader: string | null | undefined): string {
  if (!hostHeader) return "";
  let host = hostHeader.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end === -1 ? host : host.slice(0, end + 1);
  } else {
    host = host.split(":", 1)[0];
  }
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

export function hostOfUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** True for every host the app served before custom domains existed. */
export function isPlatformHost(host: string, ownHosts: string[]): boolean {
  if (!host) return true;
  if (LOCAL_HOSTS.has(host)) return true;
  if (ownHosts.includes(host)) return true;
  return PLATFORM_ZONES.some((zone) => host === zone || host.endsWith(`.${zone}`));
}

export type CustomHostRoute =
  /** Assets and booking-flow endpoints a booking page needs; served as-is. */
  | { kind: "passthrough" }
  /** "/" or "/embed": the org's own page. */
  | { kind: "root"; embed: boolean }
  /** /:user[+user2][/:type][/embed]: every user must belong to the host's org. */
  | { kind: "user"; slugs: string[] }
  /** /team/:slug[/...]: the team must belong to the host's org. */
  | { kind: "team"; slug: string }
  | { kind: "deny" };

const PASSTHROUGH_PREFIXES = ["/_next/", "/booking/", "/reschedule/", "/cancel/", "/success/"];
const DENIED_API_PREFIXES = ["/api/internal/", "/api/auth/", "/api/cron/"];
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

/**
 * Top-level segments that are app routes, never user slugs. Under a customer host they are denied,
 * so a customer domain cannot be used to reach the dashboard, login or settings.
 */
export const RESERVED_TOP_LEVEL = new Set([
  "_next",
  "api",
  "apps",
  "auth",
  "availability",
  "booking",
  "booking-successful",
  "bookings",
  "cancel",
  "d",
  "embed",
  "enterprise",
  "event-types",
  "getting-started",
  "insights",
  "login",
  "logout",
  "maintenance",
  "more",
  "onboarding",
  "org",
  "payment",
  "refer",
  "reschedule",
  "routing",
  "routing-forms",
  "settings",
  "signup",
  "success",
  "team",
  "teams",
  "upgrade",
  "video",
  "workflows",
]);

function splitUsers(segment: string): string[] {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return [];
  }
  return decoded
    .split(/[+ ]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function classifyCustomHostPath(pathname: string): CustomHostRoute {
  if (pathname === "/" || pathname === "") return { kind: "root", embed: false };
  if (pathname === "/embed") return { kind: "root", embed: true };
  if (PASSTHROUGH_PREFIXES.some((p) => pathname.startsWith(p))) return { kind: "passthrough" };
  if (pathname.startsWith("/api/")) {
    return DENIED_API_PREFIXES.some((p) => pathname.startsWith(p))
      ? { kind: "deny" }
      : { kind: "passthrough" };
  }
  if (pathname === "/favicon.ico" || pathname === "/robots.txt" || pathname === "/embed.js") {
    return { kind: "passthrough" };
  }

  const segments = pathname.split("/").filter(Boolean);
  const [first, ...rest] = segments;

  if (first === "team") {
    const slug = rest[0]?.toLowerCase();
    if (!slug || !SLUG_RE.test(slug) || rest.length > 3) return { kind: "deny" };
    return { kind: "team", slug };
  }

  // Root-level static assets (fonts, images) carry an extension and no user segment depth.
  if (segments.length === 1 && /\.[a-z0-9]{2,5}$/i.test(first)) return { kind: "passthrough" };

  if (RESERVED_TOP_LEVEL.has(first.toLowerCase())) return { kind: "deny" };

  // /:user, /:user/:type, /:user/:type/embed, /:user/embed
  if (rest.length > 2) return { kind: "deny" };
  if (rest.length === 2 && rest[1] !== "embed") return { kind: "deny" };

  const slugs = splitUsers(first);
  if (!slugs.length || slugs.length > 10 || !slugs.every((s) => SLUG_RE.test(s))) return { kind: "deny" };
  return { kind: "user", slugs };
}

/** Same destination the org-subdomain rewrite in next.config.ts uses for "/" and "/embed". */
export function orgRootRewritePath(orgSlug: string, embed: boolean): string {
  return embed ? `/team/${orgSlug}/embed?isOrgProfile=1` : `/team/${orgSlug}?isOrgProfile=1`;
}
