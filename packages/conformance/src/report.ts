import process from "node:process";
import type { Cc64Verdict, DayVerdict, DrillResult } from "./invariants.ts";
import { cc64Verdict, dayVerdict, lagStats, streak, uptimeForDay, utcDay } from "./invariants.ts";
import type { BookingLine, DrillLine, LagLine, PingLine, SweepFile } from "./store.ts";
import { DEFAULT_SOAK_DIR, SoakStore } from "./store.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReportInput = {
  bookings: BookingLine[];
  lag: LagLine[];
  drills: DrillLine[];
  pings: PingLine[];
  sweeps: SweepFile[];
  /** the current UTC day is still running and is never judged */
  now: number;
};

export type DayRow = DayVerdict & {
  attempts: number;
  doubleBookings: number | null;
  orphans: number | null;
  lagP95: number | null;
  upHours: number;
};

export type Report = { rows: DayRow[]; streak: number; drills: DrillResult[]; verdict: Cc64Verdict };

function daysBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += DAY_MS)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** S9 + S6 from the JSONL alone. A finished day without its sweep file is red: its invariants were never checked. */
export function buildReport(input: ReportInput): Report {
  const today = utcDay(new Date(input.now).toISOString());
  const stamps = [
    ...input.bookings.map((b) => b.attemptedAt),
    ...input.pings.map((p) => p.at),
    ...input.lag.map((l) => l.t0),
  ].filter(Boolean);
  const sweepByDay = new Map(input.sweeps.map((s) => [s.day, s]));
  const pingTimes = input.pings.filter((p) => p.ok).map((p) => p.at);
  const rows: DayRow[] = [];
  if (stamps.length) {
    const first = utcDay(stamps.reduce((a, b) => (a < b ? a : b)));
    const yesterday = utcDay(new Date(input.now - DAY_MS).toISOString());
    for (const day of first <= yesterday ? daysBetween(first, yesterday) : []) {
      if (day >= today) break;
      const attempts = input.bookings.filter((b) => utcDay(b.attemptedAt) === day).length;
      const lag = lagStats(input.lag.filter((l) => utcDay(l.t0) === day));
      const uptime = uptimeForDay(day, pingTimes);
      const sweep = sweepByDay.get(day);
      const v = dayVerdict({
        day,
        attempts,
        doubleBookings: sweep?.totals.doubleBookings ?? 0,
        orphans: sweep?.totals.orphans ?? 0,
        lagP95Seconds: lag.p95,
        uptime,
      });
      if (!sweep) {
        v.green = false;
        v.reasons.push("no sweep file");
      }
      rows.push({
        ...v,
        attempts,
        doubleBookings: sweep?.totals.doubleBookings ?? null,
        orphans: sweep?.totals.orphans ?? null,
        lagP95: lag.p95,
        upHours: Math.round((uptime.upMs / 3_600_000) * 100) / 100,
      });
    }
  }
  const drills: DrillResult[] = input.drills.map((d) => ({ kind: d.kind, at: d.at, pass: d.pass }));
  return { rows, streak: streak(rows).length, drills, verdict: cc64Verdict(rows, drills) };
}

export function formatReport(r: Report): string {
  const lines = ["day         verdict  attempts  double  orphans  lagP95  upH    reasons"];
  for (const row of r.rows) {
    lines.push(
      [
        row.day,
        (row.green ? "GREEN" : "RED").padEnd(7),
        String(row.attempts).padStart(8),
        String(row.doubleBookings ?? "-").padStart(6),
        String(row.orphans ?? "-").padStart(7),
        String(row.lagP95 ?? "-").padStart(6),
        String(row.upHours).padStart(5),
        row.reasons.join("; "),
      ].join("  ")
    );
  }
  lines.push("", `streak: ${r.streak} green day(s)`, "drills:");
  if (!r.drills.length) lines.push("  (none)");
  for (const d of r.drills) lines.push(`  ${d.at}  ${d.kind}  ${d.pass ? "PASS" : "FAIL"}`);
  lines.push(
    "",
    `CC-64: ${r.verdict.pass ? "PASS" : "FAIL"}${r.verdict.reasons.length ? ` (${r.verdict.reasons.join("; ")})` : ""}`
  );
  return lines.join("\n");
}

export function reportFromDir(dir: string, now = Date.now()): Report {
  const store = new SoakStore(dir);
  return buildReport({
    bookings: store.read<BookingLine>("bookings"),
    lag: store.read<LagLine>("lag"),
    drills: store.read<DrillLine>("drills"),
    pings: store.read<PingLine>("pings"),
    sweeps: store.readSweeps(),
    now,
  });
}

// basename check, not import.meta.url: run.mjs bundles this module, and the guard must not fire there
if (/[\\/]report\.(ts|mjs|js)$/.test(process.argv[1] ?? "")) {
  const report = reportFromDir(process.env.SOAK_DIR ?? DEFAULT_SOAK_DIR);
  console.log(formatReport(report));
  process.exitCode = report.verdict.pass ? 0 : 1;
}
