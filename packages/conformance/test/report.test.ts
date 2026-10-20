import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReport, formatReport, reportFromDir } from "../src/report.ts";
import type { BookingLine, DrillLine, LagLine, PingLine, SweepFile } from "../src/store.ts";
import { SoakStore } from "../src/store.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-11-01T00:00:00Z");
const dayStr = (i: number) => new Date(START + i * DAY_MS).toISOString().slice(0, 10);
const at = (i: number, offsetMs: number) => new Date(START + i * DAY_MS + offsetMs).toISOString();

function booking(i: number, n: number): BookingLine {
  const t = at(i, n * 6 * 60 * 1000);
  return {
    attemptId: `a-${i}-${n}`,
    host: ["soak-g1", "soak-g2", "soak-o1", "soak-o2"][n % 4],
    provider: "google_calendar",
    eventTypeId: 1,
    start: t,
    end: t,
    attemptedAt: t,
    reservedAt: t,
    postSentAt: t,
    respondedAt: t,
    formGapMs: 0,
    injection: { phase: "none", busyId: null, providerEventId: null, createdAt: null },
    classification: "accepted",
    status: 200,
    reason: null,
    bookingUid: `u-${i}-${n}`,
    providerEventId: `e-${i}-${n}`,
  };
}

function sweep(i: number, over: Partial<SweepFile["totals"]> = {}): SweepFile {
  return {
    day: dayStr(i),
    sweptAt: at(i + 1, 10 * 60 * 1000),
    bookingSource: "timeway-list",
    totals: {
      attempts: 220,
      accepted: 220,
      conflicts: 0,
      errors: 0,
      doubleBookings: 0,
      orphans: 0,
      lagSamples: 10,
      lagTimeouts: 0,
      lagP50: 5,
      lagP95: 10,
      ...over,
    },
    hosts: {},
    doubleBookings: [],
    orphans: [],
    errors: [],
  };
}

type Fixture = {
  bookings: BookingLine[];
  lag: LagLine[];
  drills: DrillLine[];
  pings: PingLine[];
  sweeps: SweepFile[];
};

/** `days` full days: 220 attempts, a ping every 5 min, lag 10 s, a sweep per day; tweak per day via `red`. */
function fixture(
  days: number,
  red: Record<number, "double" | "lag" | "down" | "few" | "nosweep"> = {}
): Fixture {
  const f: Fixture = { bookings: [], lag: [], drills: [], pings: [], sweeps: [] };
  for (let i = 0; i < days; i++) {
    const kind = red[i];
    const n = kind === "few" ? 150 : 220;
    for (let k = 0; k < n; k++) f.bookings.push(booking(i, k));
    for (let m = 0; m < 288; m++) {
      // "down": the runner is silent 02:00-04:00
      if (kind === "down" && m >= 24 && m < 48) continue;
      f.pings.push({ at: at(i, m * 5 * 60 * 1000 + 1000), ok: true, status: 200 });
    }
    for (let k = 0; k < 20; k++) {
      const t0 = at(i, k * 60 * 60 * 1000);
      const lagS = kind === "lag" ? 120 : 10;
      f.lag.push({
        busyId: `b-${i}-${k}`,
        host: "soak-g1",
        kind: "insert",
        slotStart: t0,
        t0,
        t1: new Date(Date.parse(t0) + lagS * 1000).toISOString(),
        polls: 2,
      });
    }
    if (kind !== "nosweep") f.sweeps.push(sweep(i, kind === "double" ? { doubleBookings: 1 } : {}));
  }
  return f;
}

const drill = (kind: DrillLine["kind"], i: number, pass = true): DrillLine => ({
  kind,
  at: at(i, 12 * 60 * 60 * 1000),
  finishedAt: at(i, 12 * 60 * 60 * 1000 + 600_000),
  host: kind === "google410" ? "soak-g1" : "soak-o1",
  pass,
  details: {},
});

const report = (f: Fixture, days: number) => buildReport({ ...f, now: START + days * DAY_MS + 3_600_000 });

describe("report verdict on fixture JSONL", () => {
  it("14 green days with both drills inside -> PASS", () => {
    const f = fixture(14);
    f.drills.push(drill("google410", 0), drill("graphSubscriptionRemoved", 5));
    const r = report(f, 14);
    expect(r.rows).toHaveLength(14);
    expect(r.rows.every((row) => row.green)).toBe(true);
    expect(r.streak).toBe(14);
    expect(r.verdict.pass).toBe(true);
    expect(formatReport(r)).toContain("CC-64: PASS");
  });

  it("a red day in the middle resets the streak -> FAIL", () => {
    const f = fixture(14, { 7: "double" });
    f.drills.push(drill("google410", 0), drill("graphSubscriptionRemoved", 5));
    const r = report(f, 14);
    expect(r.rows[7].green).toBe(false);
    expect(r.rows[7].reasons.join()).toContain("double-booking");
    expect(r.streak).toBe(6);
    expect(r.verdict.pass).toBe(false);
    expect(formatReport(r)).toContain("CC-64: FAIL");
  });

  it("missing drill -> FAIL even with 14 green days", () => {
    const f = fixture(14);
    f.drills.push(drill("google410", 0));
    const r = report(f, 14);
    expect(r.streak).toBe(14);
    expect(r.verdict.pass).toBe(false);
    expect(r.verdict.reasons.join()).toContain("graphSubscriptionRemoved");
  });

  it("a failed drill does not count", () => {
    const f = fixture(14);
    f.drills.push(drill("google410", 0), drill("graphSubscriptionRemoved", 5, false));
    expect(report(f, 14).verdict.pass).toBe(false);
  });

  it("each S9 condition turns a day red: lag p95, runner gap, < 200 attempts, missing sweep", () => {
    const f = fixture(5, { 1: "lag", 2: "down", 3: "few", 4: "nosweep" });
    const r = report(f, 5);
    expect(r.rows.map((x) => x.green)).toEqual([true, false, false, false, false]);
    expect(r.rows[1].reasons.join()).toContain("lag p95");
    expect(r.rows[2].reasons.join()).toContain("runner gap");
    expect(r.rows[3].reasons.join()).toContain("attempts < 200");
    expect(r.rows[4].reasons.join()).toContain("no sweep file");
  });

  it("the running UTC day is never judged", () => {
    const f = fixture(3);
    const r = buildReport({ ...f, now: START + 2 * DAY_MS + 3_600_000 });
    expect(r.rows.map((x) => x.day)).toEqual([dayStr(0), dayStr(1)]);
  });

  it("reads the same verdict from a /data/soak directory, tolerating a torn last line", () => {
    const dir = mkdtempSync(join(tmpdir(), "soak-report-"));
    const store = new SoakStore(dir);
    const f = fixture(14);
    f.drills.push(drill("google410", 1), drill("graphSubscriptionRemoved", 5));
    for (const b of f.bookings) store.append("bookings", b);
    for (const l of f.lag) store.append("lag", l);
    for (const p of f.pings) store.append("pings", p);
    for (const d of f.drills) store.append("drills", d);
    for (const s of f.sweeps) store.writeSweep(s);
    writeFileSync(join(dir, "lag.jsonl"), '{"torn": ', { flag: "a" });
    const r = reportFromDir(dir, START + 14 * DAY_MS + 3_600_000);
    expect(r.verdict).toEqual({ pass: true, streak: 14, reasons: [] });
  });
});
