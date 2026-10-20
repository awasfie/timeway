/**
 * CC-64 invariants (WC-TW-4 S5/S9) as pure functions over plain records, so the daily sweep and report.ts can be
 * replayed from the JSONL alone.
 */

export type Interval = { start: string; end: string };

const ms = (iso: string): number => new Date(iso).getTime();

/** Half-open intervals: a booking ending at 10:00 and one starting at 10:00 do not overlap. */
export function overlaps(a: Interval, b: Interval): boolean {
  return ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
}

export type Classification = "accepted" | "rejected-conflict" | "rejected-other";

export type BookingAttempt = Interval & {
  attemptId: string;
  host: string;
  /** when the POST /api/book/event left the harness */
  postSentAt: string;
  classification: Classification;
  bookingUid?: string | null;
  /** set when the soak later cancelled the booking (S10) */
  cancelledAt?: string | null;
};

export type SoakBusyEvent = Interval & {
  id: string;
  host: string;
  /** provider API insert time (t0 of the insert lag sample) */
  createdAt: string;
  deletedAt?: string | null;
};

export type DoubleBooking = {
  attemptId: string;
  host: string;
  with: { type: "booking"; attemptId: string } | { type: "soak-busy"; id: string };
};

function isLiveAccepted(b: BookingAttempt): boolean {
  return b.classification === "accepted" && !b.cancelledAt;
}

/**
 * S5(a). Rejections (hold/re-check/conflict) are correct behaviour and never count. A busy event only counts if it
 * existed at the provider when the POST was sent; one injected after that is a race the booking legitimately won.
 */
export function findDoubleBookings(attempts: BookingAttempt[], busyEvents: SoakBusyEvent[]): DoubleBooking[] {
  const accepted = attempts.filter(isLiveAccepted);
  const out: DoubleBooking[] = [];
  for (let i = 0; i < accepted.length; i++) {
    const a = accepted[i];
    for (let j = i + 1; j < accepted.length; j++) {
      const b = accepted[j];
      if (a.host === b.host && overlaps(a, b)) {
        // attribute to whichever was accepted second
        const [first, second] = ms(a.postSentAt) <= ms(b.postSentAt) ? [a, b] : [b, a];
        out.push({
          attemptId: second.attemptId,
          host: a.host,
          with: { type: "booking", attemptId: first.attemptId },
        });
      }
    }
    for (const busy of busyEvents) {
      if (busy.host !== a.host || !overlaps(a, busy)) continue;
      const sent = ms(a.postSentAt);
      const existedAtPost = ms(busy.createdAt) < sent && (!busy.deletedAt || ms(busy.deletedAt) > sent);
      if (existedAtPost)
        out.push({ attemptId: a.attemptId, host: a.host, with: { type: "soak-busy", id: busy.id } });
    }
  }
  return out;
}

export function countErrors(attempts: BookingAttempt[]): {
  attempts: number;
  accepted: number;
  conflicts: number;
  errors: number;
} {
  let accepted = 0;
  let conflicts = 0;
  let errors = 0;
  for (const a of attempts) {
    if (a.classification === "accepted") accepted++;
    else if (a.classification === "rejected-conflict") conflicts++;
    else errors++;
  }
  return { attempts: attempts.length, accepted, conflicts, errors };
}

export const ORPHAN_SETTLE_MS = 10 * 60 * 1000;

export type AcceptedBooking = Interval & { bookingUid: string; host: string; acceptedAt: string };

/** An event on a host's provider calendar that is not a soak-busy event (i.e. written by Timeway). */
export type ProviderBookingEvent = Interval & { id: string; host: string; createdAt?: string | null };

export type Orphan =
  | { type: "booking-without-provider-event"; host: string; bookingUid: string }
  | { type: "provider-event-without-booking"; host: string; providerEventId: string };

const slotKey = (host: string, i: Interval) => `${host}|${ms(i.start)}|${ms(i.end)}`;

/**
 * S5(b), matched 1:1 on host + exact start/end. Anything younger than the 10 min settle is not judged yet, but still
 * takes part in matching so a fresh booking's provider event is not flagged.
 */
export function findOrphans(
  bookings: AcceptedBooking[],
  providerEvents: ProviderBookingEvent[],
  checkedAt: string,
  settleMs: number = ORPHAN_SETTLE_MS
): Orphan[] {
  const cutoff = ms(checkedAt) - settleMs;
  const pool = new Map<string, ProviderBookingEvent[]>();
  for (const e of providerEvents) {
    const k = slotKey(e.host, e);
    pool.set(k, [...(pool.get(k) ?? []), e]);
  }
  const orphans: Orphan[] = [];
  const sorted = [...bookings].sort((a, b) => ms(a.acceptedAt) - ms(b.acceptedAt));
  for (const b of sorted) {
    const candidates = pool.get(slotKey(b.host, b));
    if (candidates && candidates.length) {
      candidates.shift();
      continue;
    }
    if (ms(b.acceptedAt) <= cutoff) {
      orphans.push({ type: "booking-without-provider-event", host: b.host, bookingUid: b.bookingUid });
    }
  }
  for (const leftovers of pool.values()) {
    for (const e of leftovers) {
      if (!e.createdAt || ms(e.createdAt) <= cutoff) {
        orphans.push({ type: "provider-event-without-booking", host: e.host, providerEventId: e.id });
      }
    }
  }
  return orphans;
}

export const LAG_TIMEOUT_SECONDS = 900;

export type LagSample = {
  host: string;
  kind: "insert" | "delete";
  /** provider API insert/delete time */
  t0: string;
  /** when the slot flipped in getSlots; null = never within the 15 min cap */
  t1: string | null;
};

export function lagSeconds(sample: LagSample): number {
  if (!sample.t1) return LAG_TIMEOUT_SECONDS;
  const s = Math.max(0, (ms(sample.t1) - ms(sample.t0)) / 1000);
  return Math.min(s, LAG_TIMEOUT_SECONDS);
}

/** Nearest-rank percentile (no interpolation), so a reported p95 is always a real observed sample. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function lagStats(samples: LagSample[]): {
  count: number;
  timeouts: number;
  p50: number | null;
  p95: number | null;
} {
  const values = samples.map(lagSeconds);
  return {
    count: samples.length,
    timeouts: samples.filter((s) => !s.t1).length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
  };
}

export const MIN_ATTEMPTS_PER_DAY = 200;
export const MAX_RUNNER_GAP_MS = 60 * 60 * 1000;
export const MIN_UPTIME_MS = 23 * 60 * 60 * 1000;
export const MAX_DAY_LAG_P95_SECONDS = 60;
/** Two missed 5-minute pings; a shorter silence is jitter, not downtime. */
export const DOWN_GAP_THRESHOLD_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC day "YYYY-MM-DD" for an ISO time. */
export function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export type Uptime = { maxGapMs: number; downMs: number; upMs: number };

/** Runner liveness for one UTC day from its ping times, counting the day edges as gaps too. */
export function uptimeForDay(day: string, pings: string[]): Uptime {
  const start = ms(`${day}T00:00:00.000Z`);
  const end = start + DAY_MS;
  const points = pings
    .map(ms)
    .filter((t) => t >= start && t < end)
    .sort((a, b) => a - b);
  const edges = [start, ...points, end];
  let maxGapMs = 0;
  let downMs = 0;
  for (let i = 1; i < edges.length; i++) {
    const gap = edges[i] - edges[i - 1];
    maxGapMs = Math.max(maxGapMs, gap);
    if (gap > DOWN_GAP_THRESHOLD_MS) downMs += gap;
  }
  return { maxGapMs, downMs, upMs: DAY_MS - downMs };
}

export type DayInput = {
  day: string;
  attempts: number;
  doubleBookings: number;
  orphans: number;
  lagP95Seconds: number | null;
  uptime: Uptime;
};

export type DayVerdict = { day: string; green: boolean; reasons: string[] };

/** S9: green only if every condition holds; `reasons` lists each failed one. */
export function dayVerdict(input: DayInput): DayVerdict {
  const reasons: string[] = [];
  if (input.uptime.maxGapMs > MAX_RUNNER_GAP_MS)
    reasons.push(`runner gap ${Math.round(input.uptime.maxGapMs / 60000)} min > 60 min`);
  if (input.uptime.upMs < MIN_UPTIME_MS)
    reasons.push(`runner up ${(input.uptime.upMs / 3600000).toFixed(2)} h < 23 h`);
  if (input.attempts < MIN_ATTEMPTS_PER_DAY)
    reasons.push(`${input.attempts} attempts < ${MIN_ATTEMPTS_PER_DAY}`);
  if (input.doubleBookings > 0) reasons.push(`${input.doubleBookings} double-booking(s)`);
  if (input.orphans > 0) reasons.push(`${input.orphans} orphan(s)`);
  if (input.lagP95Seconds === null) reasons.push("no lag samples");
  else if (input.lagP95Seconds >= MAX_DAY_LAG_P95_SECONDS)
    reasons.push(`lag p95 ${input.lagP95Seconds}s >= 60s`);
  return { day: input.day, green: reasons.length === 0, reasons };
}

const nextDay = (day: string): string =>
  new Date(ms(`${day}T00:00:00.000Z`) + DAY_MS).toISOString().slice(0, 10);

/**
 * Current streak = consecutive green UTC days ending at the latest verdict. A red day, or a calendar day with no
 * verdict at all, resets it to 0.
 */
export function streak(verdicts: DayVerdict[]): { length: number; days: string[] } {
  const sorted = [...verdicts].sort((a, b) => a.day.localeCompare(b.day));
  let days: string[] = [];
  let prev: string | null = null;
  for (const v of sorted) {
    if (prev !== null && v.day !== nextDay(prev)) days = [];
    days = v.green ? [...days, v.day] : [];
    prev = v.day;
  }
  return { length: days.length, days };
}

export type DrillKind = "google410" | "graphSubscriptionRemoved";
export type DrillResult = { kind: DrillKind; at: string; pass: boolean };

export const REQUIRED_STREAK_DAYS = 14;
const REQUIRED_DRILLS: DrillKind[] = ["google410", "graphSubscriptionRemoved"];

export type Cc64Verdict = { pass: boolean; streak: number; reasons: string[] };

/**
 * PASS when the current streak holds a window of 14 green days that contains a passing run of both S6 drills.
 */
export function cc64Verdict(verdicts: DayVerdict[], drills: DrillResult[]): Cc64Verdict {
  const s = streak(verdicts);
  const reasons: string[] = [];
  if (s.length < REQUIRED_STREAK_DAYS) reasons.push(`streak ${s.length} < ${REQUIRED_STREAK_DAYS} days`);
  const inStreak = new Set(s.days);
  const daysByKind = REQUIRED_DRILLS.map((kind) => {
    const passing = drills
      .filter((d) => d.kind === kind && d.pass && inStreak.has(utcDay(d.at)))
      .map((d) => ms(`${utcDay(d.at)}T00:00:00.000Z`));
    if (!passing.length) reasons.push(`no passing ${kind} drill inside the streak`);
    return passing;
  });
  if (!reasons.length) {
    // the two drills must fit in one window of 14 consecutive days inside the streak
    const [a, b] = daysByKind;
    const bestSpanDays = Math.min(...a.flatMap((x) => b.map((y) => Math.abs(x - y) / DAY_MS + 1)));
    if (bestSpanDays > REQUIRED_STREAK_DAYS)
      reasons.push("drills do not fall inside one 14-day counted window");
  }
  return { pass: reasons.length === 0, streak: s.length, reasons };
}
