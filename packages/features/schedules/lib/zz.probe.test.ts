import { prisma } from "@calcom/prisma/__mocks__/prisma";
import type { Dayjs } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import { getAggregatedAvailability } from "@calcom/features/availability/lib/getAggregatedAvailability/getAggregatedAvailability";
import { getBusyTimesFromLimits } from "@calcom/features/busyTimes/lib/getBusyTimesFromLimits";
import { getBusyTimesService } from "@calcom/features/di/containers/BusyTimes";
import type { DateRange } from "@calcom/features/schedules/lib/date-ranges";
import { buildDateRanges, subtract } from "@calcom/features/schedules/lib/date-ranges";
import getSlots from "@calcom/features/schedules/lib/slots";
import { calculatePeriodLimits, isTimeOutOfBounds, isTimeViolatingFutureLimit } from "@calcom/lib/isOutOfBounds";
import { PeriodType, SchedulingType } from "@calcom/prisma/enums";
import type { EventBusyDetails } from "@calcom/types/Calendar";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * WC-TW-5c (CC-65): property suite over the real availability pipeline in the order
 * packages/trpc/server/routers/viewer/slots/util.ts runs it. A failing config prints its
 * seed and index; replay with TW_PROP_SEED=<seed> TW_PROP_RUNS=<index+1>.
 */

vi.mock("@calcom/prisma", () => ({
  default: prisma,
  prisma,
}));

// 10,000 configs x hosts would print one "No credentials" warning per busy-times call.
vi.mock("@calcom/lib/logger", async () => {
  const { Logger } = await import("tslog");
  return { default: new Logger({ minLevel: 7 }), loggerConfig: {} };
});

vi.mock("@calcom/features/calendars/lib/CalendarManager", () => ({
  getBusyCalendarTimes: vi.fn().mockResolvedValue({ success: true, data: [] }),
  createEvent: vi.fn().mockResolvedValue({}),
  updateEvent: vi.fn().mockResolvedValue({}),
  deleteEvent: vi.fn().mockResolvedValue({}),
}));

vi.mock("@calcom/app-store/delegationCredential", () => ({
  enrichHostsWithDelegationCredentials: vi.fn(),
  getUsersCredentialsIncludeServiceAccountKey: vi.fn(),
  getCredentialForSelectedCalendar: vi.fn(),
  findUniqueDelegationCalendarCredential: vi.fn(),
  getAllDelegationCredentialsForUserIncludeServiceAccountKey: vi.fn(),
  getDelegationCredentialOrFindRegularCredential: vi.fn(),
}));

const RUNS = Number(process.env.TW_PROP_RUNS) || 10_000;
const SEED = Number(process.env.TW_PROP_SEED) || 0x5eed_2026;

const ZONES = [
  "Africa/Cairo",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Europe/London",
  "America/New_York",
  "Asia/Kolkata",
  "UTC",
];
const EVENT_ID = 1;
const OTHER_EVENT_ID = 2;
const LENGTHS = [15, 20, 25, 30, 45, 60, 90];
const FREQUENCIES = [5, 10, 15, 20, 30, 45, 60];
const BUFFERS = [0, 0, 5, 10, 15, 30, 60];
const WINDOW_DAYS = 7;
const MINUTE = 60_000;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = ReturnType<typeof mulberry32>;
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
const chance = (r: Rng, p: number) => r() < p;
const shuffle = <T>(r: Rng, xs: readonly T[]) => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const clock = (minutes: number) => new Date(Date.UTC(1970, 0, 1, Math.floor(minutes / 60), minutes % 60));

type Availability =
  | { days: number[]; startTime: Date; endTime: Date; date: null }
  | { days: number[]; startTime: Date; endTime: Date; date: Date };

type Booking = {
  id: number;
  uid: string;
  userId: number;
  title: string;
  startTime: Date;
  endTime: Date;
  eventType: {
    id: number;
    beforeEventBuffer: number;
    afterEventBuffer: number;
    seatsPerTimeSlot: number | null;
  };
  _count?: { seatsReferences: number };
};

type Host = { id: number; timeZone: string; availability: Availability[]; bookings: Booking[] };

type Config = {
  now: Date;
  bookerTimeZone: string;
  hosts: Host[];
  schedulingType: SchedulingType | null;
  length: number;
  frequency: number;
  offsetStart: number;
  beforeEventBuffer: number;
  afterEventBuffer: number;
  minimumBookingNotice: number;
  seatsPerTimeSlot: number | null;
  bookingLimitPerDay: number | null;
  periodDays: number | null;
  periodCountCalendarDays: boolean;
};

function genConfig(r: Rng): Config {
  const now = new Date(Date.UTC(2026, 0, 1) + int(r, 0, 400 * 24 * 60) * MINUTE + int(r, 0, 59) * 1000);
  const hostCount = chance(r, 0.5) ? 1 : int(r, 2, 3);
  const seatsPerTimeSlot = chance(r, 0.2) ? int(r, 2, 4) : null;
  const length = pick(r, LENGTHS);
  const hosts: Host[] = [];
  let bookingId = 1;
  for (let h = 0; h < hostCount; h++) {
    const timeZone = pick(r, ZONES);
    const availability: Availability[] = [];
    for (let i = int(r, 1, 2); i > 0; i--) {
      const days = [0, 1, 2, 3, 4, 5, 6].filter(() => chance(r, 0.7));
      const start = int(r, 0, 20) * 30 + pick(r, [0, 0, 5, 15]);
      const end = chance(r, 0.1) ? 23 * 60 + 59 : Math.min(start + int(r, 1, 20) * 30, 23 * 60 + 59);
      availability.push({ days, startTime: clock(start), endTime: clock(end), date: null });
    }
    for (let i = int(r, 0, 2); i > 0; i--) {
      const day = dayjs(now).tz(timeZone).add(int(r, 0, WINDOW_DAYS), "day").format("YYYY-MM-DD");
      const blocked = chance(r, 0.3);
      const start = blocked ? 0 : int(r, 0, 40) * 30;
      const end = blocked ? 0 : Math.min(start + int(r, 1, 16) * 30, 23 * 60 + 59);
      availability.push({
        days: [],
        startTime: clock(start),
        endTime: clock(end),
        date: new Date(`${day}T00:00:00.000Z`),
      });
    }
    const bookings: Booking[] = [];
    for (let i = int(r, 0, 8); i > 0; i--) {
      const start = new Date(
        Math.floor(now.getTime() / (5 * MINUTE)) * 5 * MINUTE + int(r, -12, WINDOW_DAYS * 24 * 12) * 5 * MINUTE
      );
      const ownEvent = chance(r, 0.6);
      const duration = ownEvent ? length : pick(r, LENGTHS);
      const seatGroup = ownEvent && seatsPerTimeSlot ? int(r, 1, seatsPerTimeSlot) : 1;
      for (let s = 0; s < seatGroup; s++) {
        bookings.push({
          id: bookingId++,
          uid: `b${bookingId}`,
          userId: h + 1,
          title: "busy",
          startTime: start,
          endTime: new Date(start.getTime() + duration * MINUTE),
          eventType: {
            id: ownEvent ? EVENT_ID : OTHER_EVENT_ID,
            beforeEventBuffer: pick(r, BUFFERS),
            afterEventBuffer: pick(r, BUFFERS),
            seatsPerTimeSlot: ownEvent ? seatsPerTimeSlot : null,
          },
          ...(ownEvent && seatsPerTimeSlot ? { _count: { seatsReferences: 1 } } : {}),
        });
      }
    }
    hosts.push({ id: h + 1, timeZone, availability, bookings });
  }
  return {
    now,
    bookerTimeZone: pick(r, ZONES),
    hosts,
    schedulingType:
      hostCount === 1 ? null : chance(r, 0.5) ? SchedulingType.COLLECTIVE : SchedulingType.ROUND_ROBIN,
    length,
    frequency: chance(r, 0.4) ? length : pick(r, FREQUENCIES),
    offsetStart: chance(r, 0.2) ? int(r, 1, 15) : 0,
    beforeEventBuffer: pick(r, BUFFERS),
    afterEventBuffer: pick(r, BUFFERS),
    minimumBookingNotice: pick(r, [0, 0, 30, 120, 600, 1440]),
    seatsPerTimeSlot,
    bookingLimitPerDay: chance(r, 0.2) ? int(r, 1, 3) : null,
    periodDays: chance(r, 0.4) ? int(r, 1, WINDOW_DAYS) : null,
    periodCountCalendarDays: chance(r, 0.5),
  };
}

function shuffledConfig(r: Rng, c: Config): Config {
  return {
    ...c,
    hosts: shuffle(
      r,
      c.hosts.map((h) => ({ ...h, availability: shuffle(r, h.availability), bookings: shuffle(r, h.bookings) }))
    ),
  };
}

function spansTransition(zone: string, now: Date) {
  const from = dayjs(now).subtract(1, "day");
  return dayjs(from).tz(zone).utcOffset() !== from.add(WINDOW_DAYS + 2, "day").tz(zone).utcOffset();
}

type HostResult = { host: Host; working: DateRange[]; limitBusy: EventBusyDetails[] };

async function runPipeline(c: Config) {
  vi.setSystemTime(c.now);
  const startTime = dayjs.utc().add(c.minimumBookingNotice || 1, "minutes").tz(c.bookerTimeZone);
  const endTime = dayjs.utc(c.now).add(WINDOW_DAYS, "day").tz(c.bookerTimeZone);
  const busyTimesService = getBusyTimesService();

  const perHost: HostResult[] = [];
  const allUsersAvailability = [];
  for (const host of c.hosts) {
    const { dateRanges, oooExcludedDateRanges } = buildDateRanges({
      dateFrom: startTime,
      dateTo: endTime,
      availability: host.availability,
      timeZone: host.timeZone,
      travelSchedules: [],
    });
    const busy = await busyTimesService.getBusyTimes({
      credentials: [],
      userId: host.id,
      userEmail: `host${host.id}@example.com`,
      username: `host${host.id}`,
      eventTypeId: EVENT_ID,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      beforeEventBuffer: c.beforeEventBuffer,
      afterEventBuffer: c.afterEventBuffer,
      selectedCalendars: [],
      seatedEvent: !!c.seatsPerTimeSlot,
      currentBookings: host.bookings,
      bypassBusyCalendarTimes: false,
    });
    const limitBusy = c.bookingLimitPerDay
      ? await getBusyTimesFromLimits(
          { PER_DAY: c.bookingLimitPerDay },
          null,
          startTime.tz(host.timeZone),
          endTime.tz(host.timeZone),
          c.length,
          { id: EVENT_ID, length: c.length } as Parameters<typeof getBusyTimesFromLimits>[5],
          host.bookings
            .filter((b) => b.eventType.id === EVENT_ID)
            .map((b) => ({ start: b.startTime, end: b.endTime, title: b.title, source: b.uid })),
          host.timeZone
        )
      : [];
    const formattedBusy = [...busy, ...limitBusy].map((b) => ({ start: dayjs(b.start), end: dayjs(b.end) }));
    // Working hours for the invariant are built over an unclipped window: the query window starts at
    // now+notice with seconds, and getSlots truncates seconds, so the clipped range is not the contract.
    const { dateRanges: working } = buildDateRanges({
      dateFrom: startTime.subtract(1, "day"),
      dateTo: endTime.add(1, "day"),
      availability: host.availability,
      timeZone: host.timeZone,
      travelSchedules: [],
    });
    perHost.push({ host, working, limitBusy });
    allUsersAvailability.push({
      dateRanges: subtract(dateRanges, formattedBusy),
      oooExcludedDateRanges: subtract(oooExcludedDateRanges, formattedBusy),
      user: { isFixed: c.schedulingType === SchedulingType.COLLECTIVE, groupId: null },
    });
  }

  const aggregated = getAggregatedAvailability(allUsersAvailability, c.schedulingType);
  const slots = getSlots({
    inviteeDate: startTime,
    eventLength: c.length,
    offsetStart: c.offsetStart,
    dateRanges: aggregated,
    minimumBookingNotice: c.minimumBookingNotice,
    frequency: c.frequency,
  });

  const periodLimits = calculatePeriodLimits({
    periodType: c.periodDays ? PeriodType.ROLLING : PeriodType.UNLIMITED,
    periodDays: c.periodDays,
    periodCountCalendarDays: c.periodCountCalendarDays,
    periodStartDate: null,
    periodEndDate: null,
    allDatesWithBookabilityStatusInBookerTz: null,
    eventUtcOffset: dayjs(c.now).tz(c.hosts[0].timeZone).utcOffset(),
    bookerUtcOffset: dayjs(c.now).tz(c.bookerTimeZone).utcOffset(),
  });
  // util.ts turns a past slot into a 400 for the whole request; surface it as a violation instead.
  const pastSlots = slots.filter((s) => s.time.valueOf() < Date.now()).map((s) => s.time.toISOString());
  const times = slots
    .filter(
      (s) =>
        s.time.valueOf() >= Date.now() &&
        !isTimeViolatingFutureLimit({ time: s.time.toISOString(), periodLimits }) &&
        !isTimeOutOfBounds({ time: s.time.toISOString(), minimumBookingNotice: c.minimumBookingNotice })
    )
    .map((s) => s.time.valueOf());
  return { times, perHost, periodLimits, pastSlots };
}

/** Independent model of what blocks a host at [t, t+len): raw bookings widened by both buffers. */
function blockingIntervals(c: Config, host: Host): [number, number][] {
  const seatCount = new Map<string, number>();
  const out: [number, number][] = [];
  for (const b of host.bookings) {
    const s = b.startTime.getTime();
    const e = b.endTime.getTime();
    const before = (b.eventType.beforeEventBuffer + c.afterEventBuffer) * MINUTE;
    const after = (b.eventType.afterEventBuffer + c.beforeEventBuffer) * MINUTE;
    if (b._count?.seatsReferences) {
      const key = `${s}-${e}`;
      const n = (seatCount.get(key) ?? 0) + 1;
      seatCount.set(key, n);
      if (n < (b.eventType.seatsPerTimeSlot || 1) && b.eventType.id === EVENT_ID) {
        if (before) out.push([s - before, s]);
        if (after) out.push([e, e + after]);
        continue;
      }
    }
    out.push([s - before, e + after]);
  }
  return out;
}

function hostAccepts(c: Config, r: HostResult, t: number): string | null {
  const end = t + c.length * MINUTE;
  const inside = r.working.some((w) => t >= w.start.valueOf() && end <= w.end.valueOf() + 999);
  if (!inside) return "outside working hours";
  const hit = blockingIntervals(c, r.host).find(([s, e]) => t < e && end > s);
  if (hit) return `overlaps busy+buffer [${new Date(hit[0]).toISOString()}, ${new Date(hit[1]).toISOString()})`;
  if (c.bookingLimitPerDay) {
    const day = dayjs(t).tz(r.host.timeZone).format("YYYY-MM-DD");
    const count = r.host.bookings.filter(
      (b) => b.eventType.id === EVENT_ID && dayjs(b.startTime).tz(r.host.timeZone).format("YYYY-MM-DD") === day
    ).length;
    if (count >= c.bookingLimitPerDay) return `booking limit ${c.bookingLimitPerDay}/day reached on ${day}`;
  }
  return null;
}

function violations(c: Config, res: Awaited<ReturnType<typeof runPipeline>>): string[] {
  const out: string[] = [];
  const nowMs = c.now.getTime();
  const horizon = res.periodLimits.endOfRollingPeriodEndDayInBookerTz?.valueOf();
  for (const iso of res.pastSlots.slice(0, 3)) out.push(`${iso}: getSlots returned a slot in the past`);
  for (const t of res.times) {
    const iso = new Date(t).toISOString();
    if (t < nowMs + c.minimumBookingNotice * MINUTE) out.push(`${iso}: before now+minimumBookingNotice`);
    if (horizon !== undefined && t > horizon) out.push(`${iso}: past rolling horizon`);
    const reasons = res.perHost.map((h) => hostAccepts(c, h, t));
    const ok =
      c.schedulingType === SchedulingType.ROUND_ROBIN ? reasons.some((x) => !x) : reasons.every((x) => !x);
    if (!ok) out.push(`${iso}: ${reasons.map((x, i) => `host${res.perHost[i].host.id}=${x ?? "ok"}`).join(", ")}`);
    if (out.length > 5) break;
  }
  return out;
}


const RAW = '{"now":"2026-10-23T12:17:06.000Z","bookerTimeZone":"UTC","hosts":[{"id":1,"timeZone":"Europe/London","availability":[{"days":[0,1,2,3,4,5],"startTime":"1970-01-01T00:30:00.000Z","endTime":"1970-01-01T01:00:00.000Z","date":null},{"days":[0,1,2,3,6],"startTime":"1970-01-01T00:45:00.000Z","endTime":"1970-01-01T08:15:00.000Z","date":null},{"days":[],"startTime":"1970-01-01T01:30:00.000Z","endTime":"1970-01-01T06:00:00.000Z","date":"2026-10-30T00:00:00.000Z"},{"days":[],"startTime":"1970-01-01T11:30:00.000Z","endTime":"1970-01-01T17:30:00.000Z","date":"2026-10-30T00:00:00.000Z"}],"bookings":[{"id":1,"uid":"b2","userId":1,"title":"busy","startTime":"2026-10-25T01:10:00.000Z","endTime":"2026-10-25T01:25:00.000Z","eventType":{"id":2,"beforeEventBuffer":5,"afterEventBuffer":30,"seatsPerTimeSlot":null}},{"id":2,"uid":"b3","userId":1,"title":"busy","startTime":"2026-10-25T10:50:00.000Z","endTime":"2026-10-25T11:10:00.000Z","eventType":{"id":2,"beforeEventBuffer":30,"afterEventBuffer":5,"seatsPerTimeSlot":null}},{"id":3,"uid":"b4","userId":1,"title":"busy","startTime":"2026-10-30T04:20:00.000Z","endTime":"2026-10-30T04:40:00.000Z","eventType":{"id":1,"beforeEventBuffer":30,"afterEventBuffer":10,"seatsPerTimeSlot":null}},{"id":4,"uid":"b5","userId":1,"title":"busy","startTime":"2026-10-27T21:25:00.000Z","endTime":"2026-10-27T22:10:00.000Z","eventType":{"id":2,"beforeEventBuffer":60,"afterEventBuffer":30,"seatsPerTimeSlot":null}},{"id":5,"uid":"b6","userId":1,"title":"busy","startTime":"2026-10-28T04:20:00.000Z","endTime":"2026-10-28T04:40:00.000Z","eventType":{"id":2,"beforeEventBuffer":0,"afterEventBuffer":10,"seatsPerTimeSlot":null}},{"id":6,"uid":"b7","userId":1,"title":"busy","startTime":"2026-10-29T02:30:00.000Z","endTime":"2026-10-29T02:50:00.000Z","eventType":{"id":1,"beforeEventBuffer":0,"afterEventBuffer":0,"seatsPerTimeSlot":null}}]},{"id":2,"timeZone":"Asia/Dubai","availability":[{"days":[1,2,3,5,6],"startTime":"1970-01-01T04:30:00.000Z","endTime":"1970-01-01T12:30:00.000Z","date":null},{"days":[0,1,2,3,5,6],"startTime":"1970-01-01T00:15:00.000Z","endTime":"1970-01-01T03:45:00.000Z","date":null}],"bookings":[{"id":7,"uid":"b8","userId":2,"title":"busy","startTime":"2026-10-25T15:00:00.000Z","endTime":"2026-10-25T15:15:00.000Z","eventType":{"id":2,"beforeEventBuffer":0,"afterEventBuffer":30,"seatsPerTimeSlot":null}},{"id":8,"uid":"b9","userId":2,"title":"busy","startTime":"2026-10-27T08:00:00.000Z","endTime":"2026-10-27T08:20:00.000Z","eventType":{"id":1,"beforeEventBuffer":5,"afterEventBuffer":60,"seatsPerTimeSlot":null}},{"id":9,"uid":"b10","userId":2,"title":"busy","startTime":"2026-10-30T11:35:00.000Z","endTime":"2026-10-30T12:35:00.000Z","eventType":{"id":2,"beforeEventBuffer":15,"afterEventBuffer":0,"seatsPerTimeSlot":null}},{"id":10,"uid":"b11","userId":2,"title":"busy","startTime":"2026-10-26T08:20:00.000Z","endTime":"2026-10-26T08:40:00.000Z","eventType":{"id":1,"beforeEventBuffer":0,"afterEventBuffer":30,"seatsPerTimeSlot":null}},{"id":11,"uid":"b12","userId":2,"title":"busy","startTime":"2026-10-25T22:50:00.000Z","endTime":"2026-10-25T23:35:00.000Z","eventType":{"id":2,"beforeEventBuffer":10,"afterEventBuffer":10,"seatsPerTimeSlot":null}},{"id":12,"uid":"b13","userId":2,"title":"busy","startTime":"2026-10-29T19:15:00.000Z","endTime":"2026-10-29T19:35:00.000Z","eventType":{"id":1,"beforeEventBuffer":30,"afterEventBuffer":15,"seatsPerTimeSlot":null}},{"id":13,"uid":"b14","userId":2,"title":"busy","startTime":"2026-10-27T22:05:00.000Z","endTime":"2026-10-27T22:25:00.000Z","eventType":{"id":1,"beforeEventBuffer":60,"afterEventBuffer":30,"seatsPerTimeSlot":null}},{"id":14,"uid":"b15","userId":2,"title":"busy","startTime":"2026-10-24T19:45:00.000Z","endTime":"2026-10-24T20:30:00.000Z","eventType":{"id":2,"beforeEventBuffer":15,"afterEventBuffer":30,"seatsPerTimeSlot":null}}]},{"id":3,"timeZone":"Africa/Cairo","availability":[{"days":[0,1,3,5,6],"startTime":"1970-01-01T02:00:00.000Z","endTime":"1970-01-01T23:59:00.000Z","date":null},{"days":[0,2,3,5,6],"startTime":"1970-01-01T00:00:00.000Z","endTime":"1970-01-01T23:59:00.000Z","date":null},{"days":[],"startTime":"1970-01-01T05:30:00.000Z","endTime":"1970-01-01T13:30:00.000Z","date":"2026-10-26T00:00:00.000Z"},{"days":[],"startTime":"1970-01-01T00:30:00.000Z","endTime":"1970-01-01T02:00:00.000Z","date":"2026-10-24T00:00:00.000Z"}],"bookings":[{"id":15,"uid":"b16","userId":3,"title":"busy","startTime":"2026-10-24T14:55:00.000Z","endTime":"2026-10-24T15:20:00.000Z","eventType":{"id":2,"beforeEventBuffer":30,"afterEventBuffer":0,"seatsPerTimeSlot":null}},{"id":16,"uid":"b17","userId":3,"title":"busy","startTime":"2026-10-30T01:50:00.000Z","endTime":"2026-10-30T02:10:00.000Z","eventType":{"id":1,"beforeEventBuffer":10,"afterEventBuffer":60,"seatsPerTimeSlot":null}},{"id":17,"uid":"b18","userId":3,"title":"busy","startTime":"2026-10-28T14:00:00.000Z","endTime":"2026-10-28T14:45:00.000Z","eventType":{"id":2,"beforeEventBuffer":60,"afterEventBuffer":30,"seatsPerTimeSlot":null}},{"id":18,"uid":"b19","userId":3,"title":"busy","startTime":"2026-10-27T02:15:00.000Z","endTime":"2026-10-27T02:35:00.000Z","eventType":{"id":1,"beforeEventBuffer":5,"afterEventBuffer":15,"seatsPerTimeSlot":null}},{"id":19,"uid":"b20","userId":3,"title":"busy","startTime":"2026-10-24T10:15:00.000Z","endTime":"2026-10-24T10:35:00.000Z","eventType":{"id":1,"beforeEventBuffer":0,"afterEventBuffer":0,"seatsPerTimeSlot":null}},{"id":20,"uid":"b21","userId":3,"title":"busy","startTime":"2026-10-29T02:20:00.000Z","endTime":"2026-10-29T02:40:00.000Z","eventType":{"id":1,"beforeEventBuffer":5,"afterEventBuffer":30,"seatsPerTimeSlot":null}}]}],"schedulingType":"ROUND_ROBIN","length":20,"frequency":20,"offsetStart":0,"beforeEventBuffer":5,"afterEventBuffer":10,"minimumBookingNotice":0,"seatsPerTimeSlot":null,"bookingLimitPerDay":null,"periodDays":6,"periodCountCalendarDays":true}';
const revive = (k: string, v: unknown) =>
  typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v;
const C0: Config = JSON.parse(RAW, revive);
const perms = <T,>(xs: T[]): T[][] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
const out = (x: unknown) => process.stderr.write(JSON.stringify(x) + "\n");
describe("probe", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
  it("p", async () => {
    vi.setSystemTime(C0.now);
    const startTime = dayjs.utc().add(C0.minimumBookingNotice || 1, "minutes").tz(C0.bookerTimeZone);
    const endTime = dayjs.utc(C0.now).add(WINDOW_DAYS, "day").tz(C0.bookerTimeZone);
    for (const h of C0.hosts) {
      const seen = new Map<string, number>();
      for (const av of perms(h.availability)) {
        const { dateRanges } = buildDateRanges({ dateFrom: startTime, dateTo: endTime, availability: av, timeZone: h.timeZone, travelSchedules: [] });
        const k = dateRanges.map((r) => `${r.start.toISOString()}/${r.end.toISOString()}`).sort().join(" ");
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      out({ host: h.id, tz: h.timeZone, variants: seen.size });
      if (seen.size > 1) for (const k of seen.keys()) out(k.split(" "));
    }
  });
});
