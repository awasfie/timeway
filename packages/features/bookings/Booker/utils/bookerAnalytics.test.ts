import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isBookerAnalyticsEnabled,
  PLAUSIBLE_QUEUE_STUB,
  resetBookerAnalytics,
  trackBookerPageView,
  trackSlotSelected,
  trackWebVital,
} from "./bookerAnalytics";

const ctx = { org: "11111111-1111-1111-1111-111111111111", eventType: 42, source: "embed" as const };

describe("bookerAnalytics", () => {
  beforeEach(() => {
    resetBookerAnalytics();
    vi.stubGlobal("window", {
      location: { origin: "https://book.example", pathname: "/jane/30min", search: "?email=a@b.c&name=Jo" },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is a no-op when the Plausible script is not loaded", () => {
    expect(() => trackBookerPageView(ctx)).not.toThrow();
    expect(() => trackSlotSelected("2026-11-01T10:00:00Z")).not.toThrow();
  });

  it("is a no-op without a window (SSR)", () => {
    vi.unstubAllGlobals();
    expect(() => trackBookerPageView(ctx)).not.toThrow();
  });

  it("sends pageview + booking_page_view with props and a query-free url", () => {
    const plausible = vi.fn();
    (window as unknown as { plausible: typeof plausible }).plausible = plausible;
    trackBookerPageView(ctx);
    const props = { org: ctx.org, event_type: 42, source: "embed" };
    const u = "https://book.example/jane/30min";
    expect(plausible).toHaveBeenNthCalledWith(1, "pageview", { u, props });
    expect(plausible).toHaveBeenNthCalledWith(2, "booking_page_view", { u, props });
    expect(JSON.stringify(plausible.mock.calls)).not.toMatch(/email|a@b\.c|Jo/);
  });

  it("fires slot_selected once per distinct slot and ignores null", () => {
    const plausible = vi.fn();
    (window as unknown as { plausible: typeof plausible }).plausible = plausible;
    trackBookerPageView(ctx);
    plausible.mockClear();
    trackSlotSelected(null);
    trackSlotSelected("s1");
    trackSlotSelected("s1");
    trackSlotSelected("s2");
    expect(plausible.mock.calls.map((c) => c[0])).toEqual(["slot_selected", "slot_selected"]);
  });

  it("uses safe placeholders when org/event type are unknown", () => {
    const plausible = vi.fn();
    (window as unknown as { plausible: typeof plausible }).plausible = plausible;
    trackBookerPageView({ org: null, eventType: null, source: "direct" });
    expect(plausible.mock.calls[1][1].props).toEqual({ org: "none", event_type: 0, source: "direct" });
  });

  it("queues events fired before pa.js loads, via the inline stub", () => {
    const w = (globalThis as unknown as { window: Record<string, unknown> }).window;
    new Function("window", PLAUSIBLE_QUEUE_STUB)(w);
    trackBookerPageView(ctx);
    trackSlotSelected("2026-11-01T10:00:00Z");
    const q = (w.plausible as unknown as { q: ArrayLike<unknown>[] }).q;
    expect(q.map((a) => a[0])).toEqual(["pageview", "booking_page_view", "slot_selected"]);
    expect(JSON.stringify(q.map((a) => Array.from(a)))).not.toMatch(/a@b\.c|Jo|email|name=/);
  });

  it("sends one web_vital per metric with rounded ms, rating, org and event_type, query-free url", () => {
    const plausible = vi.fn();
    (window as unknown as { plausible: typeof plausible }).plausible = plausible;
    trackBookerPageView(ctx);
    plausible.mockClear();
    expect(trackWebVital({ name: "INP", value: 87.6, rating: "good" })).toBe(true);
    expect(trackWebVital({ name: "INP", value: 300, rating: "poor" })).toBe(false);
    expect(trackWebVital({ name: "LCP", value: 2412.3, rating: "good" })).toBe(true);
    const u = "https://book.example/jane/30min";
    expect(plausible.mock.calls).toEqual([
      ["web_vital", { u, props: { name: "INP", value: 88, rating: "good", org: ctx.org, event_type: 42 } }],
      ["web_vital", { u, props: { name: "LCP", value: 2412, rating: "good", org: ctx.org, event_type: 42 } }],
    ]);
    expect(JSON.stringify(plausible.mock.calls)).not.toMatch(/email|a@b\.c|Jo/);
  });

  it("ignores other metrics, bad values, and a missing Plausible", () => {
    expect(isBookerAnalyticsEnabled()).toBe(false);
    expect(trackWebVital({ name: "INP", value: 50, rating: "good" })).toBe(false);
    const plausible = vi.fn();
    (window as unknown as { plausible: typeof plausible }).plausible = plausible;
    expect(isBookerAnalyticsEnabled()).toBe(true);
    expect(trackWebVital({ name: "CLS", value: 0.1, rating: "good" })).toBe(false);
    expect(trackWebVital({ name: "INP", value: Number.NaN, rating: "good" })).toBe(false);
    expect(plausible).not.toHaveBeenCalled();
    expect(trackWebVital({ name: "INP", value: 40, rating: "good" })).toBe(true);
    expect(plausible.mock.calls[0][1].props.org).toBe("none");
  });

  it("stays a no-op when the stub is not installed (env unset)", () => {
    trackBookerPageView(ctx);
    const w = (globalThis as unknown as { window: Record<string, unknown> }).window;
    expect(w.plausible).toBeUndefined();
  });
});
