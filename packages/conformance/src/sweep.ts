import type { AcceptedBooking, BookingAttempt, ProviderBookingEvent, SoakBusyEvent } from "./invariants.ts";
import { countErrors, findDoubleBookings, findOrphans, lagStats, utcDay } from "./invariants.ts";
import type { CalendarProvider } from "./providers/types.ts";
import { isSoakBusyTitle } from "./providers/types.ts";
import type { BookingLine, BusyLine, LagLine, SweepFile } from "./store.ts";
import type { HostBooking } from "./timeway.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const ms = (iso: string) => new Date(iso).getTime();

/** busy.jsonl create/delete lines folded into one record per busy event */
export function busyEvents(lines: BusyLine[]): SoakBusyEvent[] {
  const byId = new Map<string, SoakBusyEvent>();
  for (const l of lines) {
    if (l.op === "create") {
      byId.set(l.busyId, { id: l.busyId, host: l.host, start: l.start, end: l.end, createdAt: l.at });
    } else {
      const e = byId.get(l.busyId);
      if (e) e.deletedAt = l.at;
    }
  }
  return [...byId.values()];
}

/** Confirmed (accepted) bookings only; Timeway lowercases BookingStatus.ACCEPTED to "accepted". */
const isAccepted = (b: HostBooking) => b.status === "accepted";

export type SweepInput = {
  day: string;
  sweptAt: string;
  hosts: string[];
  bookingLines: BookingLine[];
  busyLines: BusyLine[];
  lagLines: LagLine[];
  /** per host: the host's bookings from Timeway; undefined = list unavailable, fall back to the runner log */
  timewayBookings?: Record<string, HostBooking[] | undefined>;
  /** per host: provider events on the host's calendar over the sweep window */
  providerEvents: Record<string, ProviderBookingEvent[]>;
  errors?: string[];
};

/**
 * S5 counts for one UTC day. Double-bookings are judged against every accepted booking of the host (any day), but
 * counted on the day the offending POST was sent. Orphans are counted for bookings and Timeway-written provider
 * events that start inside the 8-day window the day's attempts could book into.
 */
export function computeSweep(input: SweepInput): SweepFile {
  const dayStart = ms(`${input.day}T00:00:00.000Z`);
  const dayEnd = dayStart + DAY_MS;
  const inDay = (iso: string) => ms(iso) >= dayStart && ms(iso) < dayEnd;
  const busy = busyEvents(input.busyLines);
  const errors = [...(input.errors ?? [])];
  const totals: SweepFile["totals"] = {
    attempts: 0,
    accepted: 0,
    conflicts: 0,
    errors: 0,
    doubleBookings: 0,
    orphans: 0,
    lagSamples: 0,
    lagTimeouts: 0,
    lagP50: null,
    lagP95: null,
  };
  const hosts: SweepFile["hosts"] = {};
  const doubleBookings: unknown[] = [];
  const orphans: unknown[] = [];
  let anyFallback = false;

  for (const host of input.hosts) {
    const lines = input.bookingLines.filter((l) => l.host === host);
    const dayLines = lines.filter((l) => inDay(l.attemptedAt));
    const byUid = new Map(lines.filter((l) => l.bookingUid).map((l) => [l.bookingUid as string, l]));
    const listed = input.timewayBookings?.[host];
    const source = listed ? "timeway-list" : "runner-log";
    if (!listed) anyFallback = true;

    const attempts: BookingAttempt[] = listed
      ? listed.filter(isAccepted).map((b) => {
          const l = byUid.get(b.uid);
          return {
            attemptId: l?.attemptId ?? `timeway:${b.uid}`,
            host,
            start: b.start,
            end: b.end,
            postSentAt: l?.postSentAt ?? b.createdAt ?? b.start,
            classification: "accepted",
            bookingUid: b.uid,
          };
        })
      : lines
          .filter((l) => l.classification === "accepted")
          .map((l) => ({
            attemptId: l.attemptId,
            host,
            start: l.start,
            end: l.end,
            postSentAt: l.postSentAt,
            classification: l.classification,
            bookingUid: l.bookingUid,
          }));
    const doubles = findDoubleBookings(attempts, busy).filter((d) => {
      const a = attempts.find((x) => x.attemptId === d.attemptId);
      return a ? inDay(a.postSentAt) : false;
    });

    const windowStart = dayStart;
    const windowEnd = dayEnd + 8 * DAY_MS;
    const inWindow = (iso: string) => ms(iso) >= windowStart && ms(iso) < windowEnd;
    const accepted: AcceptedBooking[] = attempts
      .filter((a) => a.bookingUid && inWindow(a.start) && inDay(a.postSentAt))
      .map((a) => ({
        bookingUid: a.bookingUid as string,
        host,
        start: a.start,
        end: a.end,
        acceptedAt: a.postSentAt,
      }));
    // provider events of bookings accepted on other days must still be matchable, so pass every accepted booking
    // for matching but only judge the day's ones
    const judgedUids = new Set(accepted.map((a) => a.bookingUid));
    const allAccepted: AcceptedBooking[] = attempts
      .filter((a) => a.bookingUid)
      .map((a) => ({
        bookingUid: a.bookingUid as string,
        host,
        start: a.start,
        end: a.end,
        acceptedAt: a.postSentAt,
      }));
    const events = (input.providerEvents[host] ?? []).filter((e) => e.host === host);
    const hostOrphans = findOrphans(allAccepted, events, input.sweptAt).filter((o) =>
      o.type === "booking-without-provider-event"
        ? judgedUids.has(o.bookingUid)
        : (() => {
            const e = events.find((x) => x.id === o.providerEventId);
            return e ? inWindow(e.start) && (!e.createdAt || inDay(e.createdAt)) : false;
          })()
    );

    const c = countErrors(
      dayLines.map((l) => ({
        attemptId: l.attemptId,
        host,
        start: l.start,
        end: l.end,
        postSentAt: l.postSentAt,
        classification: l.classification,
      }))
    );
    hosts[host] = {
      attempts: c.attempts,
      accepted: c.accepted,
      doubleBookings: doubles.length,
      orphans: hostOrphans.length,
      bookingSource: source,
    };
    totals.attempts += c.attempts;
    totals.accepted += c.accepted;
    totals.conflicts += c.conflicts;
    totals.errors += c.errors;
    totals.doubleBookings += doubles.length;
    totals.orphans += hostOrphans.length;
    doubleBookings.push(...doubles);
    orphans.push(...hostOrphans);
  }

  const dayLag = input.lagLines.filter((l) => inDay(l.t0));
  const stats = lagStats(dayLag);
  totals.lagSamples = stats.count;
  totals.lagTimeouts = stats.timeouts;
  totals.lagP50 = stats.p50;
  totals.lagP95 = stats.p95;

  return {
    day: input.day,
    sweptAt: input.sweptAt,
    bookingSource: anyFallback ? "runner-log" : "timeway-list",
    totals,
    hosts,
    doubleBookings,
    orphans,
    errors,
  };
}

export type SweepHost = {
  username: string;
  calendarId: string;
  provider: CalendarProvider;
  session?: { listBookings: (from: string, to: string) => Promise<HostBooking[]> };
};

/** Gathers Timeway bookings and provider events for `day` and returns the sweep; never throws on one host's error. */
export async function runSweep(opts: {
  day: string;
  hosts: SweepHost[];
  bookingLines: BookingLine[];
  busyLines: BusyLine[];
  lagLines: LagLine[];
  now?: () => number;
}): Promise<SweepFile> {
  const dayStart = ms(`${opts.day}T00:00:00.000Z`);
  // bookings made on `day` start up to 7 days later; one extra day of margin for the 8-day window
  const from = new Date(dayStart - DAY_MS).toISOString();
  const to = new Date(dayStart + 9 * DAY_MS).toISOString();
  const timewayBookings: Record<string, HostBooking[] | undefined> = {};
  const providerEvents: Record<string, ProviderBookingEvent[]> = {};
  const errors: string[] = [];
  for (const h of opts.hosts) {
    if (h.session) {
      try {
        timewayBookings[h.username] = await h.session.listBookings(from, to);
      } catch (error) {
        errors.push(`${h.username} bookings list: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      const events = await h.provider.listEvents(h.calendarId, { start: from, end: to });
      providerEvents[h.username] = events
        .filter((e) => !isSoakBusyTitle(e.title))
        .map((e) => ({ id: e.id, host: h.username, start: e.start, end: e.end }));
    } catch (error) {
      errors.push(`${h.username} provider events: ${error instanceof Error ? error.message : String(error)}`);
      providerEvents[h.username] = [];
    }
  }
  return computeSweep({
    day: opts.day,
    sweptAt: new Date(opts.now ? opts.now() : Date.now()).toISOString(),
    hosts: opts.hosts.map((h) => h.username),
    bookingLines: opts.bookingLines,
    busyLines: opts.busyLines,
    lagLines: opts.lagLines,
    timewayBookings,
    providerEvents,
    errors,
  });
}

export const previousUtcDay = (nowMs: number): string => utcDay(new Date(nowMs - DAY_MS).toISOString());
