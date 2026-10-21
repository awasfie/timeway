import {
  createBookingScenario,
  getDate,
  getGoogleCalendarCredential,
  mockCalendar,
  TestData,
} from "@calcom/testing/lib/bookingScenario/bookingScenario";
import dayjs from "@calcom/dayjs";
import { getAvailableSlotsService } from "@calcom/features/di/containers/AvailableSlots";
import { getScheduleSchema } from "@calcom/trpc/server/routers/viewer/slots/types";
import { describe, expect, test } from "vitest";
import { buildInitialScheduleInput, getInitialScheduleTimes } from "../../../lib/booking/initialSlots";
import { setupAndTeardown } from "./setupAndTeardown";

const TZ = "Asia/Kolkata";

describe("WC-TW-6a2 seeded first-month slots", () => {
  const availableSlotsService = getAvailableSlotsService();
  setupAndTeardown();

  test("seed input equals the client useSchedule input, and slots are identical (busy, buffers, min notice)", async () => {
    const { dateString: plus2 } = getDate({ dateIncrement: 2 });
    mockCalendar("googlecalendar", {
      create: { uid: "MOCK_ID", iCalUID: "MOCKED_GOOGLE_CALENDAR_ICS_ID" },
      busySlots: [{ start: `${plus2}T04:45:00.000Z`, end: `${plus2}T10:00:00.000Z` }],
    });

    await createBookingScenario({
      eventTypes: [
        {
          id: 1,
          userId: 101,
          slug: "seed-event",
          slotInterval: 45,
          length: 45,
          beforeEventBuffer: 15,
          afterEventBuffer: 15,
          minimumBookingNotice: 24 * 60,
          users: [{ id: 101 }],
        },
      ],
      users: [
        {
          ...TestData.users.example,
          id: 101,
          schedules: [TestData.schedules.IstWorkHours],
          credentials: [getGoogleCalendarCredential()],
          selectedCalendars: [TestData.selectedCalendars.google],
        },
      ],
      apps: [TestData.apps["google-calendar"]],
    });

    const now = dayjs();
    const seedInput = buildInitialScheduleInput({
      user: TestData.users.example.username,
      slug: "seed-event",
      searchParams: new URLSearchParams(),
      timeZone: TZ,
      browserTimeZone: TZ,
      orgSlug: null,
      duration: null,
      isTeamEvent: false,
      now,
    });
    expect(seedInput).not.toBeNull();

    // What the Booker's useSchedule sends for the same visit (month view, no params).
    const [startTime, endTime] = getInitialScheduleTimes(now.tz(TZ).format("YYYY-MM"), TZ, now) ?? [];
    const clientInput = {
      isTeamEvent: false,
      usernameList: [TestData.users.example.username],
      eventTypeSlug: "seed-event",
      startTime,
      endTime,
      timeZone: TZ,
      duration: undefined,
      rescheduleUid: null,
      routedTeamMemberIds: null,
      skipContactOwner: false,
      email: null,
      embedConnectVersion: "0",
      _isDryRun: false,
    };
    expect(JSON.parse(JSON.stringify(seedInput))).toEqual(JSON.parse(JSON.stringify(clientInput)));

    const seeded = await availableSlotsService.getAvailableSlots({
      input: getScheduleSchema.parse(seedInput),
    });
    const client = await availableSlotsService.getAvailableSlots({
      input: getScheduleSchema.parse(clientInput),
    });

    expect(Object.keys(seeded.slots).length).toBeGreaterThan(0);
    expect(seeded).toEqual(client);
    // min-notice: nothing earlier than 24h from now; busy window on +2 is removed.
    const all = Object.values(seeded.slots).flat();
    expect(all.every((s) => dayjs(s.time).isAfter(now.add(24, "hour").subtract(1, "minute")))).toBe(true);
    expect(
      all.some(
        (s) =>
          dayjs(s.time).isAfter(`${plus2}T04:45:00.000Z`) && dayjs(s.time).isBefore(`${plus2}T10:00:00.000Z`)
      )
    ).toBe(false);
  });

  test("skips seeding where the Booker would not issue the same query", () => {
    const base = {
      user: "u",
      slug: "s",
      timeZone: TZ,
      browserTimeZone: TZ,
      duration: null,
      isTeamEvent: false,
    };
    expect(
      buildInitialScheduleInput({ ...base, searchParams: new URLSearchParams("cal.skipSlotsFetch=true") })
    ).toBeNull();
    expect(
      buildInitialScheduleInput({ ...base, isTeamEvent: true, searchParams: new URLSearchParams() })
    ).toBeNull();
    expect(
      buildInitialScheduleInput({ ...base, searchParams: new URLSearchParams("layout=column_view") })
    ).toBeNull();
  });
});
