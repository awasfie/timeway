// WC-TW-6g: serve anonymous booking-page HTML (timeway.co/<user>/<type>) from the Cloudflare edge.
// Every miss pays the colo -> origin (Germany) round trip; a hit answers from the visitor's colo
// (WC-TW-6e diagnosis). Anonymous HTML carries no per-visitor data, so it is keyed only by path and
// the language bucket the root layout would pick from Accept-Language.
// Deployed by ops/cloudflare/worker.py (plan/apply/rollback). Response header x-tw-edge: HIT|STALE|MISS|BYPASS.

import { LOCALES } from "./locales.mjs";

// Fresh for FRESH_S; served stale (and refreshed in the background) until MAX_STALE_S, then a plain miss.
export const FRESH_S = 60;
export const MAX_STALE_S = 300;
const STORED_AT = "x-tw-stored-at";
const KEY_ORIGIN = "https://tw-edge-cache.internal";

// First path segments that are app routes, not usernames (apps/web/app, next.config rewrites, public dirs).
const RESERVED = new Set([
  "_next", "_proxy", "api", "apps", "auth", "availability", "booking", "booking-successful", "bookings",
  "brand-preview", "cache", "call", "cancel", "connect-and-join", "d", "e2e", "embed", "enterprise",
  "event-types", "fonts", "forms", "getting-started", "icons", "ingest", "insights", "login", "maintenance",
  "more", "onboarding", "org", "payment", "privacy", "refer", "reschedule", "routing", "routing-forms",
  "settings", "signup", "static", "success", "support", "team", "teams", "terms", "trpc", "upgrade", "video",
  "workflows", "app-store", "app-categories", "country-flag-icons", "email-clients", "emails",
  "gated-features", "product-cards", "tips",
]);

const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-|__Host-)?next-auth\.session-token(?:\.\d+)?=/;
const NEXT_HEADERS = ["rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch", "next-action"];
const LOCALES_LC = LOCALES.map((l) => l.toLowerCase());
const PRIMARY_LC = new Set(LOCALES_LC.map((l) => l.split("-")[0]));

/**
 * Path is /<user>/<type> with no file extension and a non-reserved first segment. A trailing slash is
 * not matched: the origin redirects it, and refresh() would otherwise evict the canonical entry.
 */
export function isBookingPath(pathname) {
  const m = /^\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!m) return false;
  const [, user, type] = m;
  if (RESERVED.has(user.toLowerCase())) return false;
  if (user.includes(".") || type.includes(".")) return false;
  return true;
}

// Same steps as packages/features/auth/lib/getLocale.ts for a visitor with no session token:
// accept-language-parser (highest q first, stable), code/region sanity regexes, then bcp-47-match lookup.
function firstTag(header) {
  const re = /((([a-zA-Z]+(-[a-zA-Z0-9]+){0,2})|\*)(;q=[0-1](\.[0-9]+)?)?)*/g;
  const parsed = (header || "")
    .match(re)
    .filter(Boolean)
    .map((m, i) => {
      const bits = m.split(";");
      const ietf = bits[0].split("-");
      const hasScript = ietf.length === 3;
      return {
        code: ietf[0],
        region: hasScript ? ietf[2] : ietf[1],
        q: bits[1] ? Number.parseFloat(bits[1].split("=")[1]) : 1.0,
        i,
      };
    })
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return parsed[0];
}

// bcp-47-match lookup(tags, range): first tag in list order equal to some truncation of the range
// (so "es-419" resolves to "es", which precedes it in i18n.json).
function bcp47Lookup(range) {
  const lc = range.toLowerCase();
  for (let i = 0; i < LOCALES_LC.length; i++) {
    let right = lc;
    for (;;) {
      if (LOCALES_LC[i] === right) return LOCALES[i];
      let idx = right.lastIndexOf("-");
      if (idx < 0) break;
      if (right.charAt(idx - 2) === "-") idx -= 2;
      right = right.slice(0, idx);
    }
  }
  return undefined;
}

/**
 * Language the origin would render for this Accept-Language, as the tag to forward on a miss.
 * Supported locales map to their i18n.json spelling; an unsupported region of a supported language
 * (zh, zh-HK) is kept as-is because the origin renders it with that language's fallback; anything else
 * is "en". Regions longer than 3 chars are dropped so the key space stays bounded.
 */
export function languageBucket(acceptLanguage) {
  const first = firstTag(acceptLanguage);
  const code = first && /^[a-zA-Z]+$/.test(first.code) ? first.code : "en";
  const region = first?.region && /^[a-zA-Z0-9]{1,3}$/.test(first.region) ? first.region : "";
  const requested = region ? `${code}-${region}` : code;
  const supported = bcp47Lookup(requested);
  if (supported) return supported;
  if (PRIMARY_LC.has(code.toLowerCase())) return region ? `${code.toLowerCase()}-${region.toUpperCase()}` : code.toLowerCase();
  return "en";
}

/** Returns a reason string when the request must go straight to the origin, else null. */
export function bypassReason(request, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return "method";
  if (!isBookingPath(url.pathname)) return "path";
  for (const k of url.searchParams.keys()) if (!k.startsWith("utm_")) return "query";
  if (SESSION_COOKIE.test(request.headers.get("cookie") || "")) return "session";
  if (request.headers.has("authorization")) return "authorization";
  for (const h of NEXT_HEADERS) if (request.headers.has(h)) return "rsc";
  return null;
}

export function cacheKey(url, bucket) {
  return new Request(`${KEY_ORIGIN}${url.pathname}?lang=${encodeURIComponent(bucket.toLowerCase())}`);
}

function originRequest(request, url, bucket) {
  const target = new URL(url.pathname, url.origin);
  const headers = new Headers(request.headers);
  headers.set("accept-language", bucket);
  headers.delete("cookie");
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  return new Request(target.toString(), { method: "GET", headers, redirect: "manual" });
}

function storable(res) {
  if (res.status !== 200) return false;
  if (res.headers.has("set-cookie")) return false;
  return (res.headers.get("content-type") || "").startsWith("text/html");
}

function toStored(res, now) {
  const headers = new Headers(res.headers);
  headers.set("cache-control", `public, s-maxage=${MAX_STALE_S}`);
  headers.set("vary", "Accept-Encoding");
  headers.set(STORED_AT, String(now));
  headers.delete("x-tw-edge");
  return new Response(res.body, { status: res.status, headers });
}

function toClient(res, state, method) {
  const headers = new Headers(res.headers);
  // Browsers and any downstream cache must still revalidate; only this edge layer keeps a copy.
  headers.set("cache-control", "private, no-cache, no-store, max-age=0, must-revalidate");
  headers.set("x-tw-edge", state);
  const stored = headers.get(STORED_AT);
  if (stored) headers.set("age", String(Math.max(0, Math.floor((Date.now() - Number(stored)) / 1000))));
  headers.delete(STORED_AT);
  return new Response(method === "HEAD" ? null : res.body, { status: res.status, statusText: res.statusText, headers });
}

async function refresh(cache, key, request, url, bucket) {
  const res = await fetch(originRequest(request, url, bucket));
  if (storable(res)) {
    await cache.put(key, toStored(res, Date.now()));
  } else {
    // a deleted or hidden event must stop being served from the edge
    await cache.delete(key);
  }
}

export default {
  async fetch(request, env, ctx) {
    ctx.passThroughOnException();
    const url = new URL(request.url);
    const reason = bypassReason(request, url);
    if (reason) {
      const res = await fetch(request);
      if (reason === "path") return res;
      const out = new Response(res.body, res);
      out.headers.set("x-tw-edge", "BYPASS");
      return out;
    }

    const bucket = languageBucket(request.headers.get("accept-language"));
    const key = cacheKey(url, bucket);
    const cache = caches.default;
    const hit = await cache.match(key);
    if (hit) {
      const age = (Date.now() - Number(hit.headers.get(STORED_AT) || 0)) / 1000;
      if (age <= FRESH_S) return toClient(hit, "HIT", request.method);
      if (age <= MAX_STALE_S) {
        ctx.waitUntil(refresh(cache, key, request, url, bucket));
        return toClient(hit, "STALE", request.method);
      }
    }

    const res = await fetch(originRequest(request, url, bucket));
    if (!storable(res)) {
      const out = new Response(request.method === "HEAD" ? null : res.body, res);
      out.headers.set("x-tw-edge", "BYPASS");
      return out;
    }
    const stored = toStored(res, Date.now());
    ctx.waitUntil(cache.put(key, stored.clone()));
    return toClient(stored, "MISS", request.method);
  },
};
