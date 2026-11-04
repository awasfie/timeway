import getIP from "@calcom/lib/getIP";
import type { Histogram, Meter } from "@opentelemetry/api";
import { getTimewayMeter } from "./meter";

// WC-PE-12b3: field LCP for the timeway lcp-p75 SLO (salesos slo/timeway.yaml).
// Wire, identical to camv#47: `{"v":1,"name":"LCP","value":<ms>}` once per page view. Unauthenticated by
// design (every page posts it); abuse is bounded by the 256-byte cap, the strict schema, the 0..120 s range
// and 30/min per client IP. Nothing about the visitor is stored: the value is observed and dropped.

export const RUM_MAX_BODY_BYTES = 256;
export const RUM_MAX_LCP_MS = 120_000;
export const RUM_RATE_LIMIT_PER_MIN = 30;
export const RUM_APP = "timeway";
// Name already ends in the unit, so the OTLP->Prometheus translation keeps it unchanged.
export const LCP_METRIC = "web_vitals_lcp_seconds";
// 2.5 s is the WC.8.5 p75 threshold; the SLO error_query reads le="2.5", so it must stay an edge.
export const LCP_BUCKETS: readonly number[] = [0.5, 1, 1.5, 2, 2.5, 3, 4, 6, 10, 20];

export type RumParse = { ok: true; lcpMs: number } | { ok: false; status: 400 | 413 };

export function parseRum(text: string): RumParse {
  if (Buffer.byteLength(text, "utf8") > RUM_MAX_BODY_BYTES) return { ok: false, status: 413 };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, status: 400 };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400 };
  const b = body as Record<string, unknown>;
  if (Object.keys(b).sort().join(",") !== "name,v,value" || b.v !== 1 || b.name !== "LCP") {
    return { ok: false, status: 400 };
  }
  const value = b.value;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > RUM_MAX_LCP_MS) {
    return { ok: false, status: 400 };
  }
  return { ok: true, lcpMs: value };
}

export function createLcpHistogram(meter: Meter): Histogram {
  return meter.createHistogram(LCP_METRIC, {
    description: "Field Largest Contentful Paint per page view (web-vitals onLCP, final value).",
    unit: "s",
    advice: { explicitBucketBoundaries: [...LCP_BUCKETS] },
  });
}

export type RateLimit = (key: string) => boolean;

// Per-process fixed window. One web container serves timeway, and the limit only bounds metric noise,
// so a shared store is not worth a Redis/Unkey round trip on every page view.
export function createRateLimit(
  limit = RUM_RATE_LIMIT_PER_MIN,
  windowMs = 60_000,
  now = Date.now
): RateLimit {
  const hits = new Map<string, { start: number; count: number }>();
  return (key) => {
    const t = now();
    if (hits.size > 10_000) {
      hits.forEach((v, k) => {
        if (t - v.start >= windowMs) hits.delete(k);
      });
    }
    const cur = hits.get(key);
    if (!cur || t - cur.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      return true;
    }
    cur.count += 1;
    return cur.count <= limit;
  };
}

export type RumDeps = { histogram: Histogram | undefined; rateLimit: RateLimit };

let defaults: RumDeps | undefined;
function defaultDeps(): RumDeps {
  if (!defaults) {
    const meter = getTimewayMeter();
    defaults = { histogram: meter ? createLcpHistogram(meter) : undefined, rateLimit: createRateLimit() };
  }
  return defaults;
}

/** 204 accepted, 400 invalid, 413 too large, 429 rate limited. Never echoes the body. */
export async function handleRum(req: Request, deps: RumDeps = defaultDeps()): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const declared = Number(req.headers.get("content-length") || "0");
  if (declared > RUM_MAX_BODY_BYTES) return new Response(null, { status: 413, headers });
  const parsed = parseRum(await req.text());
  if (!parsed.ok) return new Response(null, { status: parsed.status, headers });
  if (!deps.rateLimit(`rum:${getIP(req)}`)) return new Response(null, { status: 429, headers });
  deps.histogram?.record(parsed.lcpMs / 1000, { app: RUM_APP });
  return new Response(null, { status: 204, headers });
}
