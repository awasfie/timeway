import {
  AggregationTemporality,
  type HistogramMetricData,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMeterProvider } from "./meter";
import {
  createLcpHistogram,
  createRateLimit,
  handleRum,
  LCP_BUCKETS,
  parseRum,
  RUM_MAX_BODY_BYTES,
  type RumDeps,
} from "./rum";
import { lcpPayload, sendLcp } from "./rum-client";

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://timeway.test/api/rum", {
    method: "POST",
    body,
    headers: { "content-type": "text/plain", ...headers },
  });

describe("parseRum", () => {
  it('accepts exactly {v:1,name:"LCP",value:ms}', () => {
    expect(parseRum('{"v":1,"name":"LCP","value":1800}')).toEqual({ ok: true, lcpMs: 1800 });
  });
  it.each([
    "not json",
    "[]",
    "null",
    '{"v":1,"name":"INP","value":100}',
    '{"v":2,"name":"LCP","value":100}',
    '{"v":1,"name":"LCP","value":0}',
    '{"v":1,"name":"LCP","value":-5}',
    '{"v":1,"name":"LCP","value":"1800"}',
    '{"v":1,"name":"LCP","value":120001}',
    '{"v":1,"name":"LCP","value":1800,"url":"/x"}',
  ])("rejects %s with 400", (s) => {
    expect(parseRum(s)).toEqual({ ok: false, status: 400 });
  });
  it("rejects oversize bodies with 413", () => {
    expect(parseRum("x".repeat(RUM_MAX_BODY_BYTES + 1))).toEqual({ ok: false, status: 413 });
  });
});

describe("POST /api/rum", () => {
  let exporter: InMemoryMetricExporter;
  let reader: PeriodicExportingMetricReader;
  let provider: MeterProvider;
  let deps: RumDeps;

  beforeEach(() => {
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 });
    provider = new MeterProvider({ readers: [reader] });
    deps = { histogram: createLcpHistogram(provider.getMeter("test")), rateLimit: () => true };
  });
  afterEach(async () => {
    await provider.shutdown();
  });

  const collected = async () => {
    const { resourceMetrics } = await reader.collect();
    return resourceMetrics.scopeMetrics
      .flatMap((s) => s.metrics)
      .filter((m) => m.descriptor.name === "web_vitals_lcp_seconds") as HistogramMetricData[];
  };

  it('204 and observes web_vitals_lcp_seconds{app="timeway"} in seconds', async () => {
    expect((await handleRum(post('{"v":1,"name":"LCP","value":1800}'), deps)).status).toBe(204);
    await handleRum(post('{"v":1,"name":"LCP","value":3200}'), deps);
    const [m] = await collected();
    expect(m.descriptor.unit).toBe("s");
    expect(m.dataPoints).toHaveLength(1);
    const dp = m.dataPoints[0];
    expect(dp.attributes).toEqual({ app: "timeway" });
    expect(dp.value.count).toBe(2);
    expect(dp.value.sum).toBeCloseTo(5);
    expect(dp.value.buckets.boundaries).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 4, 6, 10, 20]);
    // le="2.5" (cumulative) = sum of counts up to and including the 2.5 edge.
    const le25 = dp.value.buckets.counts.slice(0, dp.value.buckets.boundaries.indexOf(2.5) + 1);
    expect(le25.reduce((a, b) => a + b, 0)).toBe(1);
  });
  it('keeps 2.5 s as a bucket edge (SLO error_query uses le="2.5")', () => {
    expect(LCP_BUCKETS).toContain(2.5);
  });
  it("400 on a bad body and records nothing", async () => {
    expect((await handleRum(post('{"v":1,"name":"CLS","value":1}'), deps)).status).toBe(400);
    expect(await collected()).toEqual([]);
  });
  it("413 on a declared oversize body without reading it", async () => {
    expect((await handleRum(post("{}", { "content-length": "9999" }), deps)).status).toBe(413);
  });
  it("429 when rate limited, keyed by client IP, and records nothing", async () => {
    const rateLimit = vi.fn(() => false);
    const res = await handleRum(
      post('{"v":1,"name":"LCP","value":900}', { "cf-connecting-ip": "203.0.113.9" }),
      {
        ...deps,
        rateLimit,
      }
    );
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("rum:203.0.113.9");
    expect(await collected()).toEqual([]);
  });
  it("204 and no-op when metrics export is off (no histogram)", async () => {
    const res = await handleRum(post('{"v":1,"name":"LCP","value":900}'), {
      histogram: undefined,
      rateLimit: () => true,
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("createRateLimit", () => {
  it("allows 30 per key per minute, then 429 until the window rolls", () => {
    let t = 0;
    const limit = createRateLimit(30, 60_000, () => t);
    for (let i = 0; i < 30; i++) expect(limit("rum:a")).toBe(true);
    expect(limit("rum:a")).toBe(false);
    expect(limit("rum:b")).toBe(true);
    t = 60_000;
    expect(limit("rum:a")).toBe(true);
  });
});

describe("buildMeterProvider", () => {
  it("is off without OTEL_EXPORTER_OTLP_ENDPOINT", () => {
    expect(buildMeterProvider({ NODE_ENV: "test" })).toBeUndefined();
    expect(buildMeterProvider({ NODE_ENV: "test", OTEL_EXPORTER_OTLP_ENDPOINT: "  " })).toBeUndefined();
  });
  it("builds a provider when the endpoint is set", async () => {
    const p = buildMeterProvider({ NODE_ENV: "test", OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318/" });
    expect(p).toBeInstanceOf(MeterProvider);
    await p?.shutdown();
  });
});

describe("rum-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("builds the minimal payload with a rounded ms value", () => {
    expect(lcpPayload({ name: "LCP", value: 1834.6 })).toBe('{"v":1,"name":"LCP","value":1835}');
    expect(lcpPayload({ name: "INP", value: 100 })).toBeNull();
    expect(lcpPayload({ name: "LCP", value: 0 })).toBeNull();
  });
  it("sends through sendBeacon when available", () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    expect(sendLcp({ name: "LCP", value: 1200 })).toBe(true);
    expect(beacon).toHaveBeenCalledWith("/api/rum", '{"v":1,"name":"LCP","value":1200}');
  });
  it("falls back to fetch keepalive when sendBeacon refuses", () => {
    vi.stubGlobal("navigator", { sendBeacon: () => false });
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", f);
    expect(sendLcp({ name: "LCP", value: 700 })).toBe(true);
    expect(f).toHaveBeenCalledWith("/api/rum", expect.objectContaining({ method: "POST", keepalive: true }));
  });
});
