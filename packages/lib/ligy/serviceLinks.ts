/**
 * LK-T6a (Bible LK-12 LK-T6, Q-7 Q.LIGY): booking confirmation / reschedule / cancel links through Ligy.
 *
 * Contract: Ligy `POST /internal/service-links` (awasfie/link docs/api/link.md, LK-T5), product service key with
 * scope `service-links:write` sent as `Authorization: Bearer lks_timeway_...`. Body `{longUrl, sourceRef, title?, tags?}`;
 * `201`/`200` (idempotent replay on (longUrl, sourceRef)) -> `{id, shortUrl, sourceRef}`. The Timeway key is bound to
 * Timeway's own Ligy workspace, so no `passportOrgId` is sent.
 *
 * CC-43: the caller times out at 300 ms and falls back to the long URL. Every failure (flag off, no key, timeout,
 * non-2xx, bad body, network) returns the long URL; this module never throws and never blocks a booking email.
 *
 * Feature flag `TIMEWAY_LIGY_LINKS_ENABLED` (default off). Key by name `LIGY_SERVICE_KEY`; endpoint base
 * `LIGY_INTERNAL_URL` (default https://app.li.gy).
 */

import process from "node:process";
export const LIGY_TIMEOUT_MS = 300;
const DEFAULT_LIGY_BASE = "https://app.li.gy";

export type ServiceLinkKind = "booking" | "cancel" | "reschedule";

export type LigyConfig = {
  enabled: boolean;
  baseUrl: string;
  serviceKey: string | undefined;
  timeoutMs: number;
};

export type LigyDeps = {
  fetch?: typeof fetch;
  config?: Partial<LigyConfig>;
  onFallback?: (reason: string, kind: ServiceLinkKind) => void;
};

export function getLigyConfig(env: Record<string, string | undefined> = process.env): LigyConfig {
  return {
    enabled: env.TIMEWAY_LIGY_LINKS_ENABLED === "true",
    baseUrl: (env.LIGY_INTERNAL_URL || DEFAULT_LIGY_BASE).replace(/\/+$/, ""),
    serviceKey: env.LIGY_SERVICE_KEY || undefined,
    timeoutMs: LIGY_TIMEOUT_MS,
  };
}

/** `booking:<uid>`; the same ref for all links of a booking (Ligy dedupes on (longUrl, sourceRef)). */
export function bookingSourceRef(uid: string): string {
  return `booking:${uid}`;
}

const SHORT_URL_RE = /^https:\/\/[^\s/]+\/[^\s]+$/;

/**
 * Shorten one booking link. Returns Ligy's shortUrl, or `longUrl` unchanged on any failure (CC-43).
 */
export async function shortenBookingLink(
  args: { longUrl: string; bookingUid: string | null | undefined; kind: ServiceLinkKind },
  deps: LigyDeps = {}
): Promise<string> {
  const { longUrl, bookingUid, kind } = args;
  const cfg = { ...getLigyConfig(), ...deps.config };
  const fallback = (reason: string) => {
    deps.onFallback?.(reason, kind);
    return longUrl;
  };
  if (!cfg.enabled) return longUrl;
  if (!longUrl || !bookingUid) return fallback("missing_input");
  if (!cfg.serviceKey) return fallback("no_key");

  const doFetch = deps.fetch ?? fetch;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, cfg.timeoutMs);
  });
  try {
    const call = (async () => {
      const res = await doFetch(`${cfg.baseUrl}/internal/service-links`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.serviceKey}` },
        body: JSON.stringify({
          longUrl,
          sourceRef: bookingSourceRef(bookingUid),
          tags: ["timeway", kind],
        }),
        signal: controller.signal,
      });
      if (res.status !== 200 && res.status !== 201)
        return { error: `http_${res.status}`, shortUrl: undefined } as const;
      const body = (await res.json().catch(() => null)) as { shortUrl?: unknown } | null;
      const shortUrl = body && typeof body.shortUrl === "string" ? body.shortUrl : null;
      if (!shortUrl || !SHORT_URL_RE.test(shortUrl))
        return { error: "bad_body", shortUrl: undefined } as const;
      return { shortUrl } as const;
    })();
    const out = await Promise.race([call, timeout]);
    if (out === "timeout") return fallback("timeout");
    if (out.shortUrl === undefined) return fallback(out.error);
    return out.shortUrl;
  } catch {
    return fallback(controller.signal.aborted ? "timeout" : "network");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type BookingServiceLinks = { booking?: string; cancel?: string; reschedule?: string };

/**
 * Compose the booker's links through Ligy in parallel (total wait bounded by one 300 ms timeout).
 * Empty inputs stay empty; flag off returns `undefined` so callers keep their existing long-URL path untouched.
 */
export async function composeBookingServiceLinks(
  args: { bookingUid: string | null | undefined; links: BookingServiceLinks },
  deps: LigyDeps = {}
): Promise<BookingServiceLinks | undefined> {
  const cfg = { ...getLigyConfig(), ...deps.config };
  if (!cfg.enabled) return undefined;
  const merged: LigyDeps = { ...deps, config: cfg };
  const kinds = Object.keys(args.links) as ServiceLinkKind[];
  const out: BookingServiceLinks = {};
  await Promise.all(
    kinds.map(async (kind) => {
      const longUrl = args.links[kind];
      if (!longUrl) return;
      out[kind] = await shortenBookingLink({ longUrl, bookingUid: args.bookingUid, kind }, merged);
    })
  );
  return out;
}
