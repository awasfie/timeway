import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachLigyLinks, ligyLinksFor } from "./attachLigyLinks";
import {
  bookingSourceRef,
  composeBookingServiceLinks,
  getLigyConfig,
  LIGY_TIMEOUT_MS,
  shortenBookingLink,
} from "./serviceLinks";

const ON = {
  enabled: true,
  baseUrl: "https://ligy.test",
  serviceKey: "lks_timeway_000000000000_test",
  timeoutMs: 300,
};
const LONG = "https://timeway.test/booking/abc?changes=true";

const okFetch = (shortUrl = "https://li.gy/x1", status = 201) =>
  vi.fn(
    async () => new Response(JSON.stringify({ id: "l1", shortUrl, sourceRef: "booking:abc" }), { status })
  );

afterEach(() => {
  vi.useRealTimers();
});

describe("getLigyConfig", () => {
  it("is off by default and on only for the literal 'true'", () => {
    expect(getLigyConfig({}).enabled).toBe(false);
    expect(getLigyConfig({ TIMEWAY_LIGY_LINKS_ENABLED: "1" }).enabled).toBe(false);
    const c = getLigyConfig({
      TIMEWAY_LIGY_LINKS_ENABLED: "true",
      LIGY_INTERNAL_URL: "https://x.test/",
      LIGY_SERVICE_KEY: "k",
    });
    expect(c).toEqual({
      enabled: true,
      baseUrl: "https://x.test",
      serviceKey: "k",
      timeoutMs: LIGY_TIMEOUT_MS,
    });
    expect(LIGY_TIMEOUT_MS).toBe(300);
  });
});

describe("shortenBookingLink (compose)", () => {
  it("posts the documented contract with sourceRef booking:<uid> and returns shortUrl", async () => {
    const f = okFetch();
    const out = await shortenBookingLink(
      { longUrl: LONG, bookingUid: "abc", kind: "cancel" },
      { fetch: f, config: ON }
    );
    expect(out).toBe("https://li.gy/x1");
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ligy.test/internal/service-links");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ON.serviceKey}`);
    expect(JSON.parse(init.body as string)).toEqual({
      longUrl: LONG,
      sourceRef: "booking:abc",
      tags: ["timeway", "cancel"],
    });
    expect(bookingSourceRef("abc")).toBe("booking:abc");
  });

  it("accepts the 200 idempotent replay", async () => {
    const out = await shortenBookingLink(
      { longUrl: LONG, bookingUid: "abc", kind: "booking" },
      { fetch: okFetch("https://li.gy/x1", 200), config: ON }
    );
    expect(out).toBe("https://li.gy/x1");
  });

  it("flag off: no call, long URL", async () => {
    const f = okFetch();
    const out = await shortenBookingLink(
      { longUrl: LONG, bookingUid: "abc", kind: "booking" },
      { fetch: f, config: { ...ON, enabled: false } }
    );
    expect(out).toBe(LONG);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("shortenBookingLink (CC-43 fallback)", () => {
  const cases: [string, Partial<typeof ON>, () => typeof fetch][] = [
    ["no_key", { serviceKey: undefined }, () => okFetch() as unknown as typeof fetch],
    ["http_500", {}, () => (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch],
    ["http_401", {}, () => (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch],
    [
      "bad_body",
      {},
      () => (async () => new Response("not json", { status: 201 })) as unknown as typeof fetch,
    ],
    ["bad_body", {}, () => okFetch("javascript:alert(1)") as unknown as typeof fetch],
    [
      "network",
      {},
      () =>
        (async () => {
          throw new TypeError("fetch failed");
        }) as unknown as typeof fetch,
    ],
  ];
  for (const [reason, cfg, mk] of cases) {
    it(`${reason} -> long URL`, async () => {
      const onFallback = vi.fn();
      const out = await shortenBookingLink(
        { longUrl: LONG, bookingUid: "abc", kind: "reschedule" },
        { fetch: mk(), config: { ...ON, ...cfg }, onFallback }
      );
      expect(out).toBe(LONG);
      expect(onFallback).toHaveBeenCalledWith(reason, "reschedule");
    });
  }

  it("missing uid -> long URL without calling Ligy", async () => {
    const f = okFetch();
    expect(
      await shortenBookingLink({ longUrl: LONG, bookingUid: null, kind: "booking" }, { fetch: f, config: ON })
    ).toBe(LONG);
    expect(f).not.toHaveBeenCalled();
  });

  it("times out at 300 ms, aborts the request and returns the long URL", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const hang = vi.fn((_u: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    });
    const onFallback = vi.fn();
    const p = shortenBookingLink(
      { longUrl: LONG, bookingUid: "abc", kind: "booking" },
      { fetch: hang as unknown as typeof fetch, config: ON, onFallback }
    );
    await vi.advanceTimersByTimeAsync(299);
    expect(onFallback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe(LONG);
    expect(onFallback).toHaveBeenCalledWith("timeout", "booking");
    expect(signal?.aborted).toBe(true);
  });

  it("real clock: a slow Ligy costs ~300 ms, not more", async () => {
    const slow = (async () =>
      new Promise<Response>((r) =>
        setTimeout(() => r(new Response("{}", { status: 201 })), 2000)
      )) as unknown as typeof fetch;
    const t0 = Date.now();
    expect(
      await shortenBookingLink(
        { longUrl: LONG, bookingUid: "abc", kind: "booking" },
        { fetch: slow, config: ON }
      )
    ).toBe(LONG);
    expect(Date.now() - t0).toBeLessThan(700);
  });
});

describe("composeBookingServiceLinks", () => {
  it("flag off returns undefined", async () => {
    expect(
      await composeBookingServiceLinks(
        { bookingUid: "abc", links: { booking: LONG } },
        { config: { ...ON, enabled: false } }
      )
    ).toBeUndefined();
  });
  it("shortens each non-empty link and skips empty ones", async () => {
    let n = 0;
    const f = vi.fn(
      async () => new Response(JSON.stringify({ shortUrl: `https://li.gy/s${++n}` }), { status: 201 })
    );
    const out = await composeBookingServiceLinks(
      { bookingUid: "abc", links: { booking: LONG, cancel: LONG + "&c", reschedule: "" } },
      { fetch: f as unknown as typeof fetch, config: ON }
    );
    expect(f).toHaveBeenCalledTimes(2);
    expect(Object.keys(out ?? {}).sort()).toEqual(["booking", "cancel"]);
    expect(out?.booking).toMatch(/^https:\/\/li\.gy\/s\d$/);
  });
  it("mixed: one call fails, it falls back alone", async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string);
      return b.tags[1] === "cancel"
        ? new Response("x", { status: 502 })
        : new Response(JSON.stringify({ shortUrl: "https://li.gy/ok" }), { status: 201 });
    });
    const out = await composeBookingServiceLinks(
      { bookingUid: "abc", links: { booking: LONG, cancel: "https://timeway.test/booking/abc?cancel=true" } },
      { fetch: f as unknown as typeof fetch, config: ON }
    );
    expect(out).toEqual({
      booking: "https://li.gy/ok",
      cancel: "https://timeway.test/booking/abc?cancel=true",
    });
  });
});

const person = (email: string): Person =>
  ({
    name: email,
    email,
    timeZone: "UTC",
    language: { translate: ((k: string) => k) as never, locale: "en" },
  }) as Person;

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({
    type: "30min",
    title: "Demo",
    startTime: "2026-10-22T10:00:00Z",
    endTime: "2026-10-22T10:30:00Z",
    uid: "uid-1",
    bookerUrl: "https://timeway.test",
    organizer: person("host@timeway.test"),
    attendees: [person("Guest@Example.com")],
    ...over,
  }) as CalendarEvent;

describe("attachLigyLinks", () => {
  it("flag off: returns the same object, no calls", async () => {
    const f = okFetch();
    const ev = event();
    expect(await attachLigyLinks(ev, { fetch: f, config: { ...ON, enabled: false } })).toBe(ev);
    expect(f).not.toHaveBeenCalled();
  });

  it("platform bookings and missing uid are untouched", async () => {
    const f = okFetch();
    const p = event({ platformClientId: "pc" });
    const u = event({ uid: null });
    expect(await attachLigyLinks(p, { fetch: f, config: ON })).toBe(p);
    expect(await attachLigyLinks(u, { fetch: f, config: ON })).toBe(u);
    expect(f).not.toHaveBeenCalled();
  });

  it("composes booking/cancel/reschedule per recipient with sourceRef booking:<uid>", async () => {
    const bodies: { longUrl: string; sourceRef: string; tags: string[] }[] = [];
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string);
      bodies.push(b);
      return new Response(JSON.stringify({ shortUrl: `https://li.gy/${b.tags[1]}${bodies.length}` }), {
        status: 201,
      });
    });
    const out = await attachLigyLinks(event(), { fetch: f as unknown as typeof fetch, config: ON });
    expect(Object.keys(out.ligyLinks ?? {}).sort()).toEqual(["guest@example.com", "host@timeway.test"]);
    expect(bodies.every((b) => b.sourceRef === "booking:uid-1")).toBe(true);
    const guest = ligyLinksFor(out, { email: "GUEST@example.com" });
    expect(guest?.booking).toMatch(/^https:\/\/li\.gy\/booking/);
    expect(guest?.cancel).toMatch(/^https:\/\/li\.gy\/cancel/);
    expect(guest?.reschedule).toMatch(/^https:\/\/li\.gy\/reschedule/);
    const cancelLong = bodies.find(
      (b) => b.tags[1] === "cancel" && b.longUrl.includes("Guest%40Example.com")
    );
    expect(cancelLong?.longUrl).toContain("/booking/uid-1");
  });

  it("respects disableCancelling / disableRescheduling", async () => {
    const f = okFetch();
    const out = await attachLigyLinks(event({ disableCancelling: true, disableRescheduling: true }), {
      fetch: f,
      config: ON,
    });
    expect(ligyLinksFor(out, { email: "guest@example.com" })).toEqual({ booking: "https://li.gy/x1" });
  });

  it("Ligy down: every link keeps its long URL", async () => {
    const f = vi.fn(async () => new Response("x", { status: 503 }));
    const ev = event();
    const out = await attachLigyLinks(ev, { fetch: f as unknown as typeof fetch, config: ON });
    const g = ligyLinksFor(out, { email: "guest@example.com" });
    expect(g?.booking).toBe("https://timeway.test/booking/uid-1?changes=true");
    expect(g?.cancel).toContain("https://timeway.test/booking/uid-1");
    expect(g?.reschedule).toContain("https://timeway.test/reschedule/uid-1");
  });

  it("ligyLinksFor is undefined without overrides", () => {
    expect(ligyLinksFor(event(), { email: "guest@example.com" })).toBeUndefined();
    expect(ligyLinksFor(event({ ligyLinks: {} }), null)).toBeUndefined();
  });
});
