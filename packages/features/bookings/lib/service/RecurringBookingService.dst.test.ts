import {
  createBookingScenario,
  getBooker,
  getOrganizer,
  getScenarioData,
} from "@calcom/testing/lib/bookingScenario/bookingScenario";
import process from "node:process";
import { getRecurringBookingService } from "@calcom/features/bookings/di/RecurringBookingService.container";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { getMockRequestDataForBooking } from "@calcom/testing/lib/bookingScenario/getMockRequestDataForBooking";
import { setupAndTeardown } from "@calcom/testing/lib/bookingScenario/setupAndTeardown";
import { test } from "@calcom/testing/lib/fixtures/fixtures";
import { v4 as uuidv4 } from "uuid";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";

const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;
const timeout = process.env.CI ? 5000 : 20000;

// Egypt switches to UTC+3 on Fri 2026-04-24; Riyadh stays UTC+3 all year. A weekly series anchored on the
// booker's Riyadh wall clock therefore shifts one hour later in Cairo after the transition (WC-TW-5b D2).
const CairoWorkHours = {
  name: "09:00-17:00 Africa/Cairo",
  availability: [
    {
      days: [0, 1, 2, 3, 4, 5, 6],
      startTime: new Date("1970-01-01T09:00:00.000Z"),
      endTime: new Date("1970-01-01T17:00:00.000Z"),
      date: null,
    },
  ],
  timeZone: "Africa/Cairo",
};

async function bookWeeklySeries({
  firstStartUtc,
  occurrences,
}: {
  firstStartUtc: string;
  occurrences: number;
}) {
  const booker = getBooker({ email: "booker@example.com", name: "Booker" });
  const organizer = getOrganizer({
    name: "Cairo Host",
    email: "host@example.com",
    id: 101,
    schedules: [CairoWorkHours],
  });

  await createBookingScenario(
    getScenarioData({
      eventTypes: [
        {
          id: 1,
          slotInterval: 30,
          length: 30,
          recurringEvent: { freq: 2, count: occurrences, interval: 1 },
          users: [{ id: 101 }],
        },
      ],
      organizer,
    })
  );

  const first = new Date(firstStartUtc).getTime();
  const base = getMockRequestDataForBooking({
    data: {
      eventTypeId: 1,
      timeZone: "Asia/Riyadh",
      recurringEventId: uuidv4(),
      recurringCount: occurrences,
      responses: { email: booker.email, name: booker.name },
    },
  });
  const bookingData = Array.from({ length: occurrences }, (_, i) => ({
    ...base,
    start: new Date(first + i * WEEK_IN_MS).toISOString(),
    end: new Date(first + i * WEEK_IN_MS + 30 * 60 * 1000).toISOString(),
  }));

  return getRecurringBookingService().createBooking({
    bookingData,
    bookingMeta: { userId: -1 },
    creationSource: "WEBAPP",
  });
}

describe("handleNewRecurringBooking: every occurrence is checked against host availability", () => {
  setupAndTeardown();

  beforeEach(() => {
    vi.setSystemTime("2026-04-01T00:00:00Z");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test(
    "rejects a Riyadh 17:30 weekly series whose post-DST occurrences fall after the Cairo host's 17:00 end",
    async () => {
      // 14:30Z = 17:30 Riyadh = 16:30 Cairo on 04-16/04-23 (available), 17:30 Cairo from 04-30 (unavailable)
      await expect(
        bookWeeklySeries({ firstStartUtc: "2026-04-16T14:30:00.000Z", occurrences: 4 })
      ).rejects.toThrow(ErrorCode.NoAvailableUsersFound);
    },
    timeout
  );

  test(
    "accepts a Riyadh 12:00 weekly series that stays within Cairo host hours across the transition",
    async () => {
      const bookings = await bookWeeklySeries({ firstStartUtc: "2026-04-16T09:00:00.000Z", occurrences: 4 });
      expect(bookings).toHaveLength(4);
    },
    timeout
  );
});
