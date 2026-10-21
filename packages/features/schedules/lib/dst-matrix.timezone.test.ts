// WC-TW-5b DST matrix (CC-65 "DST matrix green"). Runs in every CI TZ pass (UTC, America/Los_Angeles,
// Africa/Cairo, Asia/Riyadh); expectations are absolute UTC instants so they must be identical in all.
// Egypt per ICU: 2026 spring 04-24 00:00 -> 01:00, fall 10-29 24:00 -> 23:00;
// 2027 spring 04-30 00:00 -> 01:00, fall 10-28 24:00 -> 23:00.

import type { Dayjs } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import { parseRecurringDates } from "@calcom/lib/parse-dates";
import { Frequency } from "@calcom/prisma/zod-utils";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DateRange } from "./date-ranges";
import { buildDateRanges } from "./date-ranges";

const hm = (h: number, m = 0) => new Date(Date.UTC(1970, 0, 1, h, m));
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const iso = (ranges: DateRange[]) =>
  ranges
    .map((r) => [r.start.toISOString(), r.end.toISOString()] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));

function workingHours({
  timeZone,
  start,
  end,
  days = ALL_DAYS,
  dateFrom,
  dateTo,
}: {
  timeZone: string;
  start: Date;
  end: Date;
  days?: number[];
  dateFrom: Dayjs;
  dateTo: Dayjs;
}) {
  return iso(
    buildDateRanges({
      availability: [{ days, startTime: start, endTime: end }],
      timeZone,
      dateFrom,
      dateTo,
      travelSchedules: [],
    }).dateRanges
  );
}

function union(ranges: (readonly [string, string])[]) {
  const sorted = [...ranges].sort((a, b) => a[0].localeCompare(b[0]));
  const out: [string, string][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) {
      if (e > last[1]) last[1] = e;
    } else {
      out.push([s, e]);
    }
  }
  return out;
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

describe("DST matrix: Egypt working hours (host Africa/Cairo, 09:00-17:00)", () => {
  it("2026 spring: transition day Fri 04-24 keeps 09:00-17:00 EEST (D1)", () => {
    expect(
      workingHours({
        timeZone: "Africa/Cairo",
        start: hm(9),
        end: hm(17),
        dateFrom: dayjs.utc("2026-04-21T22:00:00Z"), // 2026-04-22 00:00 Cairo
        dateTo: dayjs.utc("2026-04-26T20:59:59Z"),
      })
    ).toEqual([
      ["2026-04-22T07:00:00.000Z", "2026-04-22T15:00:00.000Z"],
      ["2026-04-23T07:00:00.000Z", "2026-04-23T15:00:00.000Z"],
      ["2026-04-24T06:00:00.000Z", "2026-04-24T14:00:00.000Z"],
      ["2026-04-25T06:00:00.000Z", "2026-04-25T14:00:00.000Z"],
      ["2026-04-26T06:00:00.000Z", "2026-04-26T14:00:00.000Z"],
    ]);
  });

  it("2026 fall: Thu 10-29 still EEST, Fri 10-30 EET", () => {
    expect(
      workingHours({
        timeZone: "Africa/Cairo",
        start: hm(9),
        end: hm(17),
        dateFrom: dayjs.utc("2026-10-27T21:00:00Z"), // 2026-10-28 00:00 Cairo
        dateTo: dayjs.utc("2026-10-31T21:59:59Z"),
      })
    ).toEqual([
      ["2026-10-28T06:00:00.000Z", "2026-10-28T14:00:00.000Z"],
      ["2026-10-29T06:00:00.000Z", "2026-10-29T14:00:00.000Z"],
      ["2026-10-30T07:00:00.000Z", "2026-10-30T15:00:00.000Z"],
      ["2026-10-31T07:00:00.000Z", "2026-10-31T15:00:00.000Z"],
    ]);
  });

  it("2027 spring: transition day Fri 04-30 keeps 09:00-17:00 EEST", () => {
    expect(
      workingHours({
        timeZone: "Africa/Cairo",
        start: hm(9),
        end: hm(17),
        dateFrom: dayjs.utc("2027-04-28T22:00:00Z"),
        dateTo: dayjs.utc("2027-05-01T20:59:59Z"),
      })
    ).toEqual([
      ["2027-04-29T07:00:00.000Z", "2027-04-29T15:00:00.000Z"],
      ["2027-04-30T06:00:00.000Z", "2027-04-30T14:00:00.000Z"],
      ["2027-05-01T06:00:00.000Z", "2027-05-01T14:00:00.000Z"],
    ]);
  });

  it("2027 fall: Thu 10-28 EEST, Fri 10-29 EET", () => {
    expect(
      workingHours({
        timeZone: "Africa/Cairo",
        start: hm(9),
        end: hm(17),
        dateFrom: dayjs.utc("2027-10-27T21:00:00Z"),
        dateTo: dayjs.utc("2027-10-29T21:59:59Z"),
      })
    ).toEqual([
      ["2027-10-28T06:00:00.000Z", "2027-10-28T14:00:00.000Z"],
      ["2027-10-29T07:00:00.000Z", "2027-10-29T15:00:00.000Z"],
    ]);
  });

  it("2026 fall-back night: 00:00-23:59 on Thu 10-29 covers the full 25-hour local day (D3)", () => {
    expect(
      workingHours({
        timeZone: "Africa/Cairo",
        start: hm(0),
        end: hm(23, 59),
        dateFrom: dayjs.utc("2026-10-28T21:00:00Z"), // 2026-10-29 00:00 EEST
        dateTo: dayjs.utc("2026-10-29T21:59:59Z"), // 2026-10-29 23:59:59 EET (second pass)
      })
    ).toEqual([["2026-10-28T21:00:00.000Z", "2026-10-29T22:00:00.000Z"]]);
  });
});

describe("DST matrix: DST-observing invitee x Riyadh host (no DST, 09:00-17:00 = 06:00Z-14:00Z)", () => {
  const riyadh = (dateFrom: Dayjs, dateTo: Dayjs) =>
    workingHours({ timeZone: "Asia/Riyadh", start: hm(9), end: hm(17), dateFrom, dateTo });

  it("Cairo invitee window across Egypt spring 2026", () => {
    expect(
      riyadh(dayjs.utc("2026-04-22T22:00:00Z").tz("Africa/Cairo"), dayjs.utc("2026-04-25T20:59:59Z"))
    ).toEqual([
      ["2026-04-23T06:00:00.000Z", "2026-04-23T14:00:00.000Z"],
      ["2026-04-24T06:00:00.000Z", "2026-04-24T14:00:00.000Z"],
      ["2026-04-25T06:00:00.000Z", "2026-04-25T14:00:00.000Z"],
    ]);
  });

  it("London invitee window across UK spring 2026 (03-29)", () => {
    expect(
      riyadh(dayjs.utc("2026-03-28T00:00:00Z").tz("Europe/London"), dayjs.utc("2026-03-30T22:59:59Z"))
    ).toEqual([
      ["2026-03-28T06:00:00.000Z", "2026-03-28T14:00:00.000Z"],
      ["2026-03-29T06:00:00.000Z", "2026-03-29T14:00:00.000Z"],
      ["2026-03-30T06:00:00.000Z", "2026-03-30T14:00:00.000Z"],
    ]);
  });
});

describe("DST matrix: wall clock vs UTC", () => {
  it("Europe/London 09:00-17:00 follows the wall clock across 2026-03-29", () => {
    expect(
      workingHours({
        timeZone: "Europe/London",
        start: hm(9),
        end: hm(17),
        dateFrom: dayjs.utc("2026-03-28T00:00:00Z"),
        dateTo: dayjs.utc("2026-03-30T22:59:59Z"),
      })
    ).toEqual([
      ["2026-03-28T09:00:00.000Z", "2026-03-28T17:00:00.000Z"],
      ["2026-03-29T08:00:00.000Z", "2026-03-29T16:00:00.000Z"],
      ["2026-03-30T08:00:00.000Z", "2026-03-30T16:00:00.000Z"],
    ]);
  });

  it("UTC host stays fixed in UTC across every transition", () => {
    expect(
      workingHours({
        timeZone: "UTC",
        start: hm(9),
        end: hm(17),
        dateFrom: dayjs.utc("2026-04-23T00:00:00Z"),
        dateTo: dayjs.utc("2026-04-24T23:59:59Z"),
      })
    ).toEqual([
      ["2026-04-23T09:00:00.000Z", "2026-04-23T17:00:00.000Z"],
      ["2026-04-24T09:00:00.000Z", "2026-04-24T17:00:00.000Z"],
    ]);
  });
});

describe("DST matrix: Cairo + Dubai + London round robin at midnight (union of host ranges)", () => {
  const hosts = (dateFrom: Dayjs, dateTo: Dayjs) =>
    union([
      ...workingHours({ timeZone: "Africa/Cairo", start: hm(20), end: hm(23, 59), dateFrom, dateTo }),
      ...workingHours({ timeZone: "Asia/Dubai", start: hm(0), end: hm(4), dateFrom, dateTo }),
      ...workingHours({ timeZone: "Europe/London", start: hm(22), end: hm(23, 59), dateFrom, dateTo }),
    ]);

  it("summer (all three on summer/fixed offsets)", () => {
    expect(hosts(dayjs.utc("2026-06-10T12:00:00Z"), dayjs.utc("2026-06-11T06:00:00Z"))).toEqual([
      // Cairo 20:00-24:00 EEST = 17:00Z-21:00Z; Dubai 06-11 00:00-04:00 = 20:00Z-00:00Z;
      // London 22:00-24:00 BST = 21:00Z-23:00Z.
      ["2026-06-10T17:00:00.000Z", "2026-06-11T00:00:00.000Z"],
    ]);
  });

  it("Egypt fall-back night 2026-10-29 (London already on GMT)", () => {
    expect(hosts(dayjs.utc("2026-10-29T12:00:00Z"), dayjs.utc("2026-10-30T06:00:00Z"))).toEqual([
      // Cairo 10-29 20:00-24:00 (EEST then 23:00-24:00 EET twice) = 17:00Z-22:00Z;
      // Dubai 10-30 00:00-04:00 = 20:00Z-00:00Z; London 22:00-24:00 GMT = 22:00Z-00:00Z.
      ["2026-10-29T17:00:00.000Z", "2026-10-30T00:00:00.000Z"],
    ]);
  });
});

describe("DST matrix: recurring weekly across a transition (D2)", () => {
  const weekly = { freq: Frequency.WEEKLY, count: 4, interval: 1 };
  const occurrences = (startDate: string, timeZone: string) =>
    parseRecurringDates(
      { startDate, timeZone, recurringEvent: weekly, recurringCount: 4, withDefaultTimeFormat: true },
      "en"
    )[1].map((d) => d.toISOString());

  it("anchored to the booker's tz: Cairo booker keeps 10:00 Cairo after 04-24", () => {
    expect(occurrences("2026-04-16T08:00:00.000Z", "Africa/Cairo")).toEqual([
      "2026-04-16T08:00:00.000Z",
      "2026-04-23T08:00:00.000Z",
      "2026-04-30T07:00:00.000Z",
      "2026-05-07T07:00:00.000Z",
    ]);
  });

  it("Riyadh booker (no DST) keeps fixed UTC instants regardless of Egypt's transition", () => {
    expect(occurrences("2026-04-16T07:00:00.000Z", "Asia/Riyadh")).toEqual([
      "2026-04-16T07:00:00.000Z",
      "2026-04-23T07:00:00.000Z",
      "2026-04-30T07:00:00.000Z",
      "2026-05-07T07:00:00.000Z",
    ]);
  });

  it("UTC booker keeps fixed UTC instants", () => {
    expect(occurrences("2026-04-16T08:00:00.000Z", "UTC")).toEqual([
      "2026-04-16T08:00:00.000Z",
      "2026-04-23T08:00:00.000Z",
      "2026-04-30T08:00:00.000Z",
      "2026-05-07T08:00:00.000Z",
    ]);
  });

  it("America/New_York booker keeps 10:00 local across US spring 2027 (03-14)", () => {
    expect(occurrences("2027-03-04T15:00:00.000Z", "America/New_York")).toEqual([
      "2027-03-04T15:00:00.000Z",
      "2027-03-11T15:00:00.000Z",
      "2027-03-18T14:00:00.000Z",
      "2027-03-25T14:00:00.000Z",
    ]);
  });

  it("Cairo booker keeps 10:00 Cairo across Egypt fall 2027 (10-28)", () => {
    expect(occurrences("2027-10-21T07:00:00.000Z", "Africa/Cairo")).toEqual([
      "2027-10-21T07:00:00.000Z",
      "2027-10-28T07:00:00.000Z",
      "2027-11-04T08:00:00.000Z",
      "2027-11-11T08:00:00.000Z",
    ]);
  });
});
