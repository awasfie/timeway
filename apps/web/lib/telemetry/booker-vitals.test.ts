import { resetBookerAnalytics } from "@calcom/features/bookings/Booker/utils/bookerAnalytics";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBookerWebVitals, startBookerWebVitals } from "./booker-vitals";

const flush = () => new Promise((r) => setTimeout(r, 0));

function deps() {
  const onINP = vi.fn();
  const onLCP = vi.fn();
  const loadINP = vi.fn(async () => ({ onINP }));
  return {
    onINP,
    onLCP,
    loadINP,
    d: { onLCP, loadINP } as unknown as Parameters<typeof startBookerWebVitals>[0],
  };
}

describe("startBookerWebVitals", () => {
  beforeEach(() => {
    resetBookerAnalytics();
    resetBookerWebVitals();
    vi.stubGlobal("window", {
      location: { origin: "https://book.example", pathname: "/jane/30min", search: "" },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does nothing when Plausible is not on the page", () => {
    const { onLCP, loadINP, d } = deps();
    expect(startBookerWebVitals(d)).toBe(false);
    expect(onLCP).not.toHaveBeenCalled();
    expect(loadINP).not.toHaveBeenCalled();
  });

  it("wires onLCP + lazy onINP once, to web_vital events", async () => {
    const plausible = vi.fn();
    (window as unknown as { plausible: typeof plausible }).plausible = plausible;
    const { onINP, onLCP, loadINP, d } = deps();
    expect(startBookerWebVitals(d)).toBe(true);
    expect(startBookerWebVitals(d)).toBe(false);
    await flush();
    expect(loadINP).toHaveBeenCalledTimes(1);
    onINP.mock.calls[0][0]({ name: "INP", value: 120.4, rating: "good" });
    onLCP.mock.calls[0][0]({ name: "LCP", value: 1800, rating: "good" });
    expect(plausible.mock.calls.map((c) => [c[0], c[1].props.name, c[1].props.value])).toEqual([
      ["web_vital", "INP", 120],
      ["web_vital", "LCP", 1800],
    ]);
  });

  it("swallows a failed INP chunk load", async () => {
    (window as unknown as { plausible: () => void }).plausible = vi.fn();
    const onLCP = vi.fn();
    const d = { onLCP, loadINP: () => Promise.reject(new Error("chunk")) } as unknown as Parameters<
      typeof startBookerWebVitals
    >[0];
    expect(startBookerWebVitals(d)).toBe(true);
    await flush();
    expect(onLCP).toHaveBeenCalledTimes(1);
  });
});
