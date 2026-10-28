import { afterEach, describe, expect, it, vi } from "vitest";

import { buildPlausibleRequest, trackServerEvent } from "./trackServerEvent";

describe("trackServerEvent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is a no-op when PLAUSIBLE_HOST or PLAUSIBLE_DOMAIN is unset", () => {
    expect(buildPlausibleRequest("booking_confirmed", {}, {})).toBeNull();
    expect(buildPlausibleRequest("booking_confirmed", {}, { PLAUSIBLE_HOST: "https://s.t" })).toBeNull();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("PLAUSIBLE_HOST", "");
    trackServerEvent("booking_confirmed", { org: "o" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds the Events API body with only non-empty props", () => {
    const req = buildPlausibleRequest(
      "event_type_published",
      { org: "org-1", event_type: 42, source: null },
      { PLAUSIBLE_HOST: "https://stats.timeway.co/", PLAUSIBLE_DOMAIN: "timeway.co" }
    );
    expect(req).toEqual({
      url: "https://stats.timeway.co/api/event",
      body: {
        name: "event_type_published",
        domain: "timeway.co",
        url: "https://timeway.co/server/event_type_published",
        props: { org: "org-1", event_type: "42" },
      },
    });
  });

  it("does not throw when fetch rejects", async () => {
    vi.stubEnv("PLAUSIBLE_HOST", "https://stats.timeway.co");
    vi.stubEnv("PLAUSIBLE_DOMAIN", "timeway.co");
    const fetchMock = vi.fn().mockRejectedValue(new Error("down"));
    vi.stubGlobal("fetch", fetchMock);
    expect(() => trackServerEvent("calendar_connected", { org: "o" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
