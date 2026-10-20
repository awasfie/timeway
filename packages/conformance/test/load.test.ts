import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttemptPlan, SoakHost } from "../src/load.ts";
import {
  DAY_MS,
  LoadRunner,
  MAX_FORM_GAP_MS,
  planHostDay,
  pollUntilFlip,
  realClock,
  runScheduler,
} from "../src/load.ts";
import type { ProviderEvent } from "../src/providers/types.ts";
import type { BookingLine, BusyLine, LagLine } from "../src/store.ts";
import type { BookInput, BookResult, SlotsByDate } from "../src/timeway.ts";

const HOSTS = ["soak-g1", "soak-g2", "soak-o1", "soak-o2"];
const DAY0 = Date.parse("2026-11-02T00:00:00Z");

/** seeded LCG so every run of the suite sees the same plan */
function seeded(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("planHostDay", () => {
  it("spreads >= 50 attempts over the UTC day with ~30 % injected and >= 1/3 of those in-form", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const plans = planHostDay("soak-g1", DAY0, seeded(seed));
      expect(plans.length).toBeGreaterThanOrEqual(50);
      for (const p of plans) {
        expect(p.at).toBeGreaterThanOrEqual(DAY0);
        expect(p.at).toBeLessThan(DAY0 + DAY_MS);
      }
      const injected = plans.filter((p) => p.injection !== "none");
      const share = injected.length / plans.length;
      expect(share).toBeGreaterThan(0.25);
      expect(share).toBeLessThan(0.35);
      const inForm = injected.filter((p) => p.injection === "in-form").length;
      expect(inForm / injected.length).toBeGreaterThanOrEqual(1 / 3);
    }
  });

  it("jitters: two days never share the same timetable and no two attempts of a host collide", () => {
    const a = planHostDay("soak-g1", DAY0, seeded(1)).map((p) => p.at - DAY0);
    const b = planHostDay("soak-g1", DAY0 + DAY_MS, seeded(2)).map((p) => p.at - DAY0 - DAY_MS);
    expect(a).not.toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe("runScheduler over a simulated UTC day (fake timers)", () => {
  it("fires >= 200 attempts across the 4 hosts, >= 50 each, >= 1/3 of injections in-form", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(DAY0);
    const fired: AttemptPlan[] = [];
    const ac = new AbortController();
    const done = runScheduler({
      hosts: HOSTS,
      execute: async (p) => {
        fired.push(p);
      },
      clock: realClock,
      random: seeded(7),
      signal: ac.signal,
    });
    await vi.advanceTimersByTimeAsync(DAY_MS - 1);
    ac.abort();
    await vi.advanceTimersByTimeAsync(DAY_MS);
    await done;

    expect(fired.length).toBeGreaterThanOrEqual(200);
    for (const h of HOSTS) expect(fired.filter((p) => p.host === h).length).toBeGreaterThanOrEqual(50);
    for (const p of fired) expect(p.at).toBeLessThan(DAY0 + DAY_MS);
    const injected = fired.filter((p) => p.injection !== "none");
    expect(injected.filter((p) => p.injection === "in-form").length / injected.length).toBeGreaterThanOrEqual(
      1 / 3
    );
    // S4 rate limit: never more than 10 POSTs in any 60 s window from one IP
    const times = fired.map((p) => p.at).sort((x, y) => x - y);
    for (let i = 0; i + 10 < times.length; i++) expect(times[i + 10] - times[i]).toBeGreaterThan(60_000);
  });

  it("skips plans already in the past when started mid-day instead of bursting them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(DAY0 + DAY_MS / 2);
    const fired: AttemptPlan[] = [];
    const ac = new AbortController();
    const done = runScheduler({
      hosts: HOSTS,
      execute: async (p) => {
        fired.push(p);
      },
      random: seeded(3),
      signal: ac.signal,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fired.length).toBeLessThanOrEqual(1);
    ac.abort();
    await vi.advanceTimersByTimeAsync(DAY_MS);
    await done;
  });
});

describe("pollUntilFlip", () => {
  it("returns the first poll time the slot flips", async () => {
    let t = 0;
    const clock = { now: () => t, sleep: async (ms: number) => void (t += ms) };
    const seq = [true, true, false];
    const r = await pollUntilFlip({ offered: async () => seq.shift() ?? false, want: false, clock });
    expect(r).toEqual({ t1: 10_000, polls: 3 });
  });

  it("gives up at the 900 s cap with t1 = null; failed polls do not count as a flip", async () => {
    let t = 0;
    const clock = { now: () => t, sleep: async (ms: number) => void (t += ms) };
    const r = await pollUntilFlip({
      offered: async () => {
        throw new Error("5xx");
      },
      want: false,
      clock,
    });
    expect(r.t1).toBeNull();
    expect(r.polls).toBe(181);
  });
});

/** In-memory store + fake provider + fake Timeway: exercises one attempt end to end with no network. */
function harness(opts: { bookStatus: number; bookBody: Record<string, unknown> }) {
  let t = Date.parse("2026-11-02T10:00:00Z");
  const clock = { now: () => t, sleep: async (ms: number) => void (t += ms) };
  const written: Record<string, unknown[]> = { bookings: [], busy: [], lag: [], drills: [], pings: [] };
  const store = {
    append: (f: string, r: unknown) => written[f].push(r),
    read: (f: string) => written[f],
  };
  const slot = "2026-11-03T09:00:00.000Z";
  const busy = new Map<string, ProviderEvent>();
  const timewayEvents: ProviderEvent[] = [];
  const events: string[] = [];
  const provider = {
    name: "google_calendar" as const,
    insertBusyEvent: async (_c: string, i: { soakId: string; start: string; end: string }) => {
      events.push(`insert@${t}`);
      const e = {
        id: `b-${i.soakId}`,
        title: `soak-busy-${i.soakId}`,
        start: i.start,
        end: i.end,
        busy: true,
      };
      busy.set(e.id, e);
      return e;
    },
    deleteEvent: async (_c: string, id: string) => {
      events.push(`delete@${t}`);
      busy.delete(id);
    },
    listEvents: async () => [...busy.values(), ...timewayEvents],
  };
  const timeway = {
    getSlots: async (): Promise<SlotsByDate> => ({ "2026-11-03": busy.size ? [] : [slot] }),
    reserveSlot: async () => {
      events.push(`reserve@${t}`);
      return { uid: "hold-1" };
    },
    book: async (input: BookInput): Promise<BookResult> => {
      events.push(`post@${t}`);
      if (opts.bookStatus === 200)
        timewayEvents.push({ id: "tw-evt-1", title: "Soak", start: input.start, end: input.end, busy: true });
      return {
        classification: opts.bookStatus === 200 ? "accepted" : "rejected-conflict",
        status: opts.bookStatus,
        reason: (opts.bookBody.message as string) ?? null,
        bookingUid: (opts.bookBody.uid as string) ?? null,
        bookingId: null,
        bookingStatus: null,
      };
    },
  };
  const host: SoakHost = {
    username: "soak-g1",
    eventTypeId: 11,
    eventTypeSlug: "soak-30",
    calendarId: "cal-g1",
    provider,
  };
  const runner = new LoadRunner({
    // the runner only calls append/read on the store and the four client methods above
    store: store as never,
    timeway: timeway as never,
    hosts: { "soak-g1": host },
    runId: "r1",
    clock,
    random: seeded(5),
  });
  return { runner, written, events, slot };
}

describe("LoadRunner.execute", () => {
  it("in-form: the busy event lands between reserveSlot and the POST, within the 0-90 s gap", async () => {
    const h = harness({ bookStatus: 409, bookBody: { message: "booking_conflict_error" } });
    const line = (await h.runner.execute({ host: "soak-g1", at: 0, injection: "in-form" })) as BookingLine;
    const at = (k: string) => Number(h.events.find((e) => e.startsWith(k))?.split("@")[1]);
    expect(at("reserve")).toBeLessThanOrEqual(at("insert"));
    expect(at("insert")).toBeLessThanOrEqual(at("post"));
    expect(at("post") - at("reserve")).toBeLessThanOrEqual(MAX_FORM_GAP_MS);
    expect(line.injection.phase).toBe("in-form");
    expect(line.classification).toBe("rejected-conflict");
    const busy = h.written.busy as BusyLine[];
    expect(busy.map((b) => b.op)).toEqual(["create", "delete"]);
    const lag = h.written.lag as LagLine[];
    expect(lag.map((l) => l.kind)).toEqual(["insert", "delete"]);
    expect(lag.every((l) => l.t1 !== null)).toBe(true);
    expect(h.written.bookings).toHaveLength(1);
  });

  it("accepted: records booking uid and the Timeway-written provider event id", async () => {
    const h = harness({ bookStatus: 200, bookBody: { uid: "bk-1" } });
    const line = (await h.runner.execute({ host: "soak-g1", at: 0, injection: "none" })) as BookingLine;
    expect(line.classification).toBe("accepted");
    expect(line.bookingUid).toBe("bk-1");
    expect(line.providerEventId).toBe("tw-evt-1");
    expect(line.start).toBe(h.slot);
  });
});
