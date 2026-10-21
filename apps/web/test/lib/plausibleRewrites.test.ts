import { describe, expect, it } from "vitest";
import { getPlausibleRewrites } from "../../plausibleRewrites";

describe("getPlausibleRewrites", () => {
  it("returns no rewrites when PLAUSIBLE_HOST is unset or blank", () => {
    expect(getPlausibleRewrites(undefined)).toEqual([]);
    expect(getPlausibleRewrites("")).toEqual([]);
    expect(getPlausibleRewrites("   ")).toEqual([]);
  });

  it("maps the first-party paths to the Plausible host (bare hostname gets https)", () => {
    expect(getPlausibleRewrites("stats.timeway.co")).toEqual([
      {
        source: "/js/pa.js",
        destination: "https://stats.timeway.co/js/script.manual.tagged-events.pageview-props.js",
      },
      { source: "/api/pa/event", destination: "https://stats.timeway.co/api/event" },
    ]);
  });

  it("keeps an explicit scheme and strips trailing slashes", () => {
    const [script, event] = getPlausibleRewrites("http://plausible.local:8000//");
    expect(script.destination).toBe("http://plausible.local:8000/js/script.manual.tagged-events.pageview-props.js");
    expect(event.destination).toBe("http://plausible.local:8000/api/event");
  });
});
