import { describe, expect, it } from "vitest";
import type { BookingAttempt, DayInput, DayVerdict, LagSample, SoakBusyEvent } from "../src/invariants.ts";
import {
  cc64Verdict,
  countErrors,
  dayVerdict,
  findDoubleBookings,
  findOrphans,
  lagSeconds,
  lagStats,
  overlaps,
  percentile,
  streak,
  uptimeForDay,
} from "../src/invariants.ts";

const T = (hhmm: string, day = "2026-11-02") => `${day}T${hhmm}:00.000Z`;

const attempt = (
  over: Partial<BookingAttempt> & Pick<BookingAttempt, "attemptId" | "start" | "end">
): BookingAttempt => ({
  host: "soak-g1",
  postSentAt: T("08:00"),
  classification: "accepted",
  ...over,
});

describe("overlaps", () => {
  it("edge-touching intervals (end == start) are not an overlap", () => {
    expect(overlaps({ start: T("10:00"), end: T("10:30") }, { start: T("10:30"), end: T("11:00") })).toBe(
      false
    );
    expect(overlaps({ start: T("10:30"), end: T("11:00") }, { start: T("10:00"), end: T("10:30") })).toBe(
      false
    );
  });
  it("partial and contained intervals overlap", () => {
    expect(overlaps({ start: T("10:00"), end: T("10:30") }, { start: T("10:29"), end: T("11:00") })).toBe(
      true
    );
    expect(overlaps({ start: T("10:00"), end: T("11:00") }, { start: T("10:10"), end: T("10:20") })).toBe(
      true
    );
  });
});

describe("findDoubleBookings (S5a)", () => {
  it("flags two accepted bookings of the same host that overlap, attributed to the later POST", () => {
    const found = findDoubleBookings(
      [
        attempt({ attemptId: "a", start: T("10:00"), end: T("10:30"), postSentAt: T("08:00") }),
        attempt({ attemptId: "b", start: T("10:15"), end: T("10:45"), postSentAt: T("08:05") }),
      ],
      []
    );
    expect(found).toEqual([{ attemptId: "b", host: "soak-g1", with: { type: "booking", attemptId: "a" } }]);
  });

  it("does not flag back-to-back bookings or overlaps on different hosts", () => {
    expect(
      findDoubleBookings(
        [
          attempt({ attemptId: "a", start: T("10:00"), end: T("10:30") }),
          attempt({ attemptId: "b", start: T("10:30"), end: T("11:00") }),
          attempt({ attemptId: "c", host: "soak-g2", start: T("10:00"), end: T("10:30") }),
        ],
        []
      )
    ).toEqual([]);
  });

  it("a conflict rejection is correct behaviour: not a double-booking and not an error", () => {
    const attempts = [
      attempt({ attemptId: "a", start: T("10:00"), end: T("10:30") }),
      attempt({ attemptId: "b", start: T("10:00"), end: T("10:30"), classification: "rejected-conflict" }),
    ];
    expect(findDoubleBookings(attempts, [])).toEqual([]);
    expect(countErrors(attempts)).toEqual({ attempts: 2, accepted: 1, conflicts: 1, errors: 0 });
  });

  it("counts rejected-other as an error", () => {
    expect(
      countErrors([
        attempt({ attemptId: "x", start: T("10:00"), end: T("10:30"), classification: "rejected-other" }),
      ]).errors
    ).toBe(1);
  });

  it("flags an accepted booking over a soak-busy event that existed before the POST", () => {
    const busy: SoakBusyEvent[] = [
      { id: "e1", host: "soak-g1", start: T("10:00"), end: T("10:30"), createdAt: T("07:59") },
    ];
    const found = findDoubleBookings(
      [attempt({ attemptId: "a", start: T("10:00"), end: T("10:30"), postSentAt: T("08:00") })],
      busy
    );
    expect(found).toEqual([{ attemptId: "a", host: "soak-g1", with: { type: "soak-busy", id: "e1" } }]);
  });

  it("ignores a busy event injected after the POST was sent, or deleted before it", () => {
    const busy: SoakBusyEvent[] = [
      {
        id: "late",
        host: "soak-g1",
        start: T("10:00"),
        end: T("10:30"),
        createdAt: "2026-11-02T08:00:30.000Z",
      },
      {
        id: "gone",
        host: "soak-g1",
        start: T("10:00"),
        end: T("10:30"),
        createdAt: T("07:00"),
        deletedAt: T("07:30"),
      },
    ];
    expect(
      findDoubleBookings(
        [attempt({ attemptId: "a", start: T("10:00"), end: T("10:30"), postSentAt: T("08:00") })],
        busy
      )
    ).toEqual([]);
  });

  it("ignores bookings the soak cancelled", () => {
    expect(
      findDoubleBookings(
        [
          attempt({ attemptId: "a", start: T("10:00"), end: T("10:30"), cancelledAt: T("09:00") }),
          attempt({ attemptId: "b", start: T("10:00"), end: T("10:30") }),
        ],
        []
      )
    ).toEqual([]);
  });
});

describe("findOrphans (S5b)", () => {
  const checkedAt = T("12:00");
  const booking = (uid: string, acceptedAt: string) => ({
    bookingUid: uid,
    host: "soak-o1",
    start: T("14:00"),
    end: T("14:30"),
    acceptedAt,
  });

  it("matched booking and provider event: no orphan", () => {
    expect(
      findOrphans(
        [booking("b1", T("11:00"))],
        [{ id: "p1", host: "soak-o1", start: T("14:00"), end: T("14:30"), createdAt: T("11:00") }],
        checkedAt
      )
    ).toEqual([]);
  });

  it("a booking older than the 10 min settle with no provider event is an orphan", () => {
    expect(findOrphans([booking("b1", T("11:49"))], [], checkedAt)).toEqual([
      { type: "booking-without-provider-event", host: "soak-o1", bookingUid: "b1" },
    ]);
  });

  it("inside the settle window it is not judged yet", () => {
    expect(findOrphans([booking("b1", T("11:51"))], [], checkedAt)).toEqual([]);
  });

  it("exactly at the settle boundary (10 min old) it is judged", () => {
    expect(findOrphans([booking("b1", T("11:50"))], [], checkedAt)).toHaveLength(1);
  });

  it("a settled Timeway-written provider event with no booking is an orphan; a fresh one is not", () => {
    const events = [
      { id: "old", host: "soak-o1", start: T("15:00"), end: T("15:30"), createdAt: T("11:00") },
      { id: "new", host: "soak-o1", start: T("16:00"), end: T("16:30"), createdAt: T("11:55") },
    ];
    expect(findOrphans([], events, checkedAt)).toEqual([
      { type: "provider-event-without-booking", host: "soak-o1", providerEventId: "old" },
    ]);
  });

  it("matches 1:1, so two bookings on one provider event leave one orphan", () => {
    const orphans = findOrphans(
      [booking("b1", T("11:00")), booking("b2", T("11:01"))],
      [{ id: "p1", host: "soak-o1", start: T("14:00"), end: T("14:30"), createdAt: T("11:00") }],
      checkedAt
    );
    expect(orphans).toEqual([{ type: "booking-without-provider-event", host: "soak-o1", bookingUid: "b2" }]);
  });
});

describe("lag (S5c)", () => {
  it("p95 over a known sample uses nearest rank", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 95)).toBeNull();
  });

  it("a timeout sample (no t1) counts as 900 s", () => {
    expect(lagSeconds({ host: "soak-g1", kind: "insert", t0: T("10:00"), t1: null })).toBe(900);
  });

  it("measures t1 - t0 in seconds and caps at 900", () => {
    expect(
      lagSeconds({
        host: "soak-g1",
        kind: "delete",
        t0: "2026-11-02T10:00:00.000Z",
        t1: "2026-11-02T10:00:12.500Z",
      })
    ).toBe(12.5);
    expect(lagSeconds({ host: "soak-g1", kind: "delete", t0: T("10:00"), t1: T("10:20") })).toBe(900);
  });

  it("lagStats folds timeouts into p95", () => {
    const fast: LagSample[] = Array.from({ length: 19 }, () => ({
      host: "soak-g1",
      kind: "insert" as const,
      t0: "2026-11-02T10:00:00.000Z",
      t1: "2026-11-02T10:00:10.000Z",
    }));
    const stats = lagStats([...fast, { host: "soak-g1", kind: "insert", t0: T("10:00"), t1: null }]);
    expect(stats).toEqual({ count: 20, timeouts: 1, p50: 10, p95: 10 });
    const stats2 = lagStats([
      ...fast.slice(0, 18),
      { host: "soak-g1", kind: "insert", t0: T("10:00"), t1: null },
      { host: "soak-g1", kind: "insert", t0: T("10:00"), t1: null },
    ]);
    expect(stats2.p95).toBe(900);
  });
});

const everyFiveMinutes = (day: string, skipFrom?: string, skipTo?: string): string[] => {
  const out: string[] = [];
  const start = new Date(`${day}T00:00:00.000Z`).getTime();
  for (let t = start; t < start + 86_400_000; t += 300_000) {
    const iso = new Date(t).toISOString();
    if (skipFrom && skipTo && iso >= skipFrom && iso < skipTo) continue;
    out.push(iso);
  }
  return out;
};

const goodDay = (day: string): DayInput => ({
  day,
  attempts: 210,
  doubleBookings: 0,
  orphans: 0,
  lagP95Seconds: 12,
  uptime: uptimeForDay(day, everyFiveMinutes(day)),
});

describe("day verdict (S9)", () => {
  it("a healthy day is green", () => {
    expect(dayVerdict(goodDay("2026-11-02"))).toEqual({ day: "2026-11-02", green: true, reasons: [] });
  });

  it("a day under 200 attempts is red", () => {
    const v = dayVerdict({ ...goodDay("2026-11-02"), attempts: 199 });
    expect(v.green).toBe(false);
    expect(v.reasons).toEqual(["199 attempts < 200"]);
  });

  it("a runner gap > 60 min is red", () => {
    const day = "2026-11-02";
    const uptime = uptimeForDay(day, everyFiveMinutes(day, T("03:00", day), T("04:05", day)));
    expect(uptime.maxGapMs).toBeGreaterThan(60 * 60 * 1000);
    const v = dayVerdict({ ...goodDay(day), uptime });
    expect(v.green).toBe(false);
    expect(v.reasons[0]).toMatch(/runner gap \d+ min > 60 min/);
  });

  it("a 55 min gap alone stays green (>= 23 h up)", () => {
    const day = "2026-11-02";
    const uptime = uptimeForDay(day, everyFiveMinutes(day, T("03:00", day), T("03:50", day)));
    expect(dayVerdict({ ...goodDay(day), uptime }).green).toBe(true);
  });

  it("any double-booking, orphan, or p95 >= 60 s is red", () => {
    expect(dayVerdict({ ...goodDay("2026-11-02"), doubleBookings: 1 }).green).toBe(false);
    expect(dayVerdict({ ...goodDay("2026-11-02"), orphans: 1 }).green).toBe(false);
    expect(dayVerdict({ ...goodDay("2026-11-02"), lagP95Seconds: 60 }).green).toBe(false);
    expect(dayVerdict({ ...goodDay("2026-11-02"), lagP95Seconds: null }).green).toBe(false);
  });
});

const days = (from: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) =>
    new Date(new Date(`${from}T00:00:00.000Z`).getTime() + i * 86_400_000).toISOString().slice(0, 10)
  );

const green = (day: string): DayVerdict => ({ day, green: true, reasons: [] });
const red = (day: string): DayVerdict => ({ day, green: false, reasons: ["x"] });

describe("streak and CC-64 verdict", () => {
  it("counts consecutive green days", () => {
    expect(streak(days("2026-11-01", 5).map(green)).length).toBe(5);
  });

  it("a red day resets the streak to 0", () => {
    const ds = days("2026-11-01", 10);
    const verdicts = ds.map((d, i) => (i === 6 ? red(d) : green(d)));
    expect(streak(verdicts)).toEqual({ length: 3, days: ds.slice(7) });
    expect(streak([...ds.slice(0, 3).map(green), red(ds[3])]).length).toBe(0);
  });

  it("a missing day breaks the streak", () => {
    const ds = days("2026-11-01", 6);
    expect(streak([green(ds[0]), green(ds[1]), green(ds[3]), green(ds[4])]).length).toBe(2);
  });

  it("PASS needs 14 green days and both drills passing inside them", () => {
    const ds = days("2026-11-01", 14);
    const drills = [
      { kind: "google410" as const, at: `${ds[0]}T12:00:00.000Z`, pass: true },
      { kind: "graphSubscriptionRemoved" as const, at: `${ds[5]}T12:00:00.000Z`, pass: true },
    ];
    expect(cc64Verdict(ds.map(green), drills)).toEqual({ pass: true, streak: 14, reasons: [] });
  });

  it("FAIL when a drill is missing, failed, or before the streak", () => {
    const ds = days("2026-11-01", 15);
    const verdicts = ds.map((d, i) => (i === 0 ? red(d) : green(d)));
    const v1 = cc64Verdict(verdicts, [{ kind: "google410", at: `${ds[3]}T12:00:00.000Z`, pass: true }]);
    expect(v1.pass).toBe(false);
    expect(v1.reasons).toEqual(["no passing graphSubscriptionRemoved drill inside the streak"]);
    const v2 = cc64Verdict(ds.map(green), [
      { kind: "google410", at: `${ds[3]}T12:00:00.000Z`, pass: true },
      { kind: "graphSubscriptionRemoved", at: `${ds[0]}T12:00:00.000Z`, pass: false },
    ]);
    expect(v2.pass).toBe(false);
    const v3 = cc64Verdict(verdicts, [
      { kind: "google410", at: `${ds[0]}T12:00:00.000Z`, pass: true },
      { kind: "graphSubscriptionRemoved", at: `${ds[4]}T12:00:00.000Z`, pass: true },
    ]);
    expect(v3.pass).toBe(false);
  });

  it("FAIL under 14 days even with both drills", () => {
    const ds = days("2026-11-01", 13);
    const v = cc64Verdict(ds.map(green), [
      { kind: "google410", at: `${ds[0]}T12:00:00.000Z`, pass: true },
      { kind: "graphSubscriptionRemoved", at: `${ds[1]}T12:00:00.000Z`, pass: true },
    ]);
    expect(v).toEqual({ pass: false, streak: 13, reasons: ["streak 13 < 14 days"] });
  });

  it("FAIL when the two drills are more than 14 days apart in a longer streak", () => {
    const ds = days("2026-11-01", 20);
    const v = cc64Verdict(ds.map(green), [
      { kind: "google410", at: `${ds[0]}T12:00:00.000Z`, pass: true },
      { kind: "graphSubscriptionRemoved", at: `${ds[19]}T12:00:00.000Z`, pass: true },
    ]);
    expect(v.pass).toBe(false);
  });
});
