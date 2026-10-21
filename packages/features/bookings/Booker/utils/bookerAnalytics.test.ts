import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetBookerAnalytics,
  trackBookerPageView,
  trackSlotSelected,
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
});
