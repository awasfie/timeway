import { resetBookerAnalytics } from "@calcom/features/bookings/Booker/utils/bookerAnalytics";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBookerWebVitals, startBookerWebVitals } from "./booker-vitals";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("startBookerWebVitals", () => {
  beforeEach(() => {
    resetBookerAnalytics();
    resetBookerWebVitals();
    vi.stubGlobal("window", {
      location: { origin: "https://book.example", pathname: "/jane/30min", search: "" },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does not load web-vitals when Plausible is not on the page", () => {
    const load = vi.fn();
    expect(startBookerWebVitals(load)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it("loads web-vitals once and wires onINP + onLCP to web_vital events", async () => {
    const plausible = vi.fn();
    (window as unknown as { plausible: typeof plausible }).plausible = plausible;
    const onINP = vi.fn();
    const onLCP = vi.fn();
    const load = vi.fn(async () => ({ onINP, onLCP }));
    expect(startBookerWebVitals(load as never)).toBe(true);
    expect(startBookerWebVitals(load as never)).toBe(false);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    onINP.mock.calls[0][0]({ name: "INP", value: 120.4, rating: "good" });
    onLCP.mock.calls[0][0]({ name: "LCP", value: 1800, rating: "good" });
    expect(plausible.mock.calls.map((c) => [c[0], c[1].props.name, c[1].props.value])).toEqual([
      ["web_vital", "INP", 120],
      ["web_vital", "LCP", 1800],
    ]);
  });

  it("allows a retry when the chunk fails to load", async () => {
    (window as unknown as { plausible: () => void }).plausible = vi.fn();
    expect(startBookerWebVitals(() => Promise.reject(new Error("chunk")))).toBe(true);
    await flush();
    expect(startBookerWebVitals(async () => ({ onINP: vi.fn(), onLCP: vi.fn() }) as never)).toBe(true);
  });
});
