/**
 * TW-ORGID-INS: every Booking insert carries the booked event type's twOrgId.
 *
 * Seen on prod 2026-10-16: a public, unauthenticated team booking (/team/<slug>/<type>)
 * was inserted with Booking.twOrgId NULL. The org must come from the event type row,
 * not from any request-scoped org context, because the public path has none.
 */
import {
  BookingLocations,
  createBookingScenario,
  getBooker,
  getDate,
  getGoogleCalendarCredential,
  getOrganizer,
  getScenarioData,
  mockCalendarToHaveNoBusySlots,
  mockSuccessfulVideoMeetingCreation,
  TestData,
} from "@calcom/testing/lib/bookingScenario/bookingScenario";
import process from "node:process";
import prismaMock from "@calcom/testing/lib/__mocks__/prisma";
import { SchedulingType } from "@calcom/prisma/enums";
import { expectBookingToBeInDatabase } from "@calcom/testing/lib/bookingScenario/expects";
import { getMockRequestDataForBooking } from "@calcom/testing/lib/bookingScenario/getMockRequestDataForBooking";
import { setupAndTeardown } from "@calcom/testing/lib/bookingScenario/setupAndTeardown";
import { describe, expect, test } from "vitest";
import { getNewBookingHandler } from "./getNewBookingHandler";

const ORG_A = "5f94bad6-0000-4000-8000-000000000001";

const timeout = process.env.CI ? 5000 : 20000;

async function setupTeamEventType({
  twOrgId,
  seatsPerTimeSlot,
}: {
  twOrgId: string | null;
  seatsPerTimeSlot?: number;
}) {
  const otherTeamMember = {
    name: "Other Team Member 1",
    username: "other-team-member-1",
    timeZone: "Asia/Kolkata",
    defaultScheduleId: null,
    email: "other-team-member-1@example.com",
    id: 102,
    schedules: [TestData.schedules.IstWorkHours],
    credentials: [getGoogleCalendarCredential()],
    selectedCalendars: [TestData.selectedCalendars.google],
  };

  const organizer = getOrganizer({
    name: "Organizer",
    email: "organizer@example.com",
    id: 101,
    defaultScheduleId: null,
    schedules: [TestData.schedules.IstWorkHours],
    credentials: [getGoogleCalendarCredential()],
    selectedCalendars: [TestData.selectedCalendars.google],
    teams: [
      {
        membership: { accepted: true },
        team: { id: 1, name: "Team 1", slug: "team-1" },
      },
    ],
  });

  await createBookingScenario(
    getScenarioData({
      eventTypes: [
        {
          id: 1,
          teamId: 1,
          slotInterval: 30,
          length: 30,
          schedulingType: SchedulingType.ROUND_ROBIN,
          users: [{ id: 101 }, { id: 102 }],
          twOrgId,
          ...(seatsPerTimeSlot ? { seatsPerTimeSlot, seatsShowAttendees: false } : {}),
        },
      ],
      organizer,
      usersApartFromOrganizer: [otherTeamMember],
      apps: [TestData.apps["google-calendar"], TestData.apps["daily-video"]],
    })
  );

  mockSuccessfulVideoMeetingCreation({
    metadataLookupKey: "dailyvideo",
    videoMeetingData: {
      id: "MOCK_ID",
      password: "MOCK_PASS",
      url: "http://mock-dailyvideo.example.com/m",
    },
  });
  mockCalendarToHaveNoBusySlots("googlecalendar", {
    create: {
      id: "MOCKED_GOOGLE_CALENDAR_EVENT_ID",
      iCalUID: "MOCKED_GOOGLE_CALENDAR_ICS_ID",
    },
  });
}

function bookingRequest() {
  const booker = getBooker({ email: "booker@example.com", name: "Booker" });
  return getMockRequestDataForBooking({
    data: {
      start: `${getDate({ dateIncrement: 1 }).dateString}T05:00:00.000Z`,
      end: `${getDate({ dateIncrement: 1 }).dateString}T05:30:00.000Z`,
      eventTypeId: 1,
      responses: {
        email: booker.email,
        name: booker.name,
        location: { optionValue: "", value: BookingLocations.CalVideo },
      },
    },
  });
}

describe("TW-ORGID-INS: Booking.twOrgId comes from the event type", () => {
  setupAndTeardown();

  test(
    "public (unauthenticated, no org context) team booking gets the event type's twOrgId",
    async () => {
      await setupTeamEventType({ twOrgId: ORG_A });
      const handleNewBooking = getNewBookingHandler();

      // No userId, no session, no tw-org-context scope: the public booking page path.
      const created = await handleNewBooking({ bookingData: bookingRequest() });

      expect(created.uid).toBeTruthy();
      await expectBookingToBeInDatabase({
        uid: created.uid!,
        eventTypeId: 1,
        twOrgId: ORG_A,
      });
    },
    timeout
  );

  test(
    "seated team event type: the first seat's booking row gets the event type's twOrgId",
    async () => {
      await setupTeamEventType({ twOrgId: ORG_A, seatsPerTimeSlot: 3 });
      const handleNewBooking = getNewBookingHandler();

      const created = await handleNewBooking({ bookingData: bookingRequest() });

      await expectBookingToBeInDatabase({
        uid: created.uid!,
        eventTypeId: 1,
        twOrgId: ORG_A,
      });
    },
    timeout
  );

  test(
    "an event type with no org still inserts NULL (no org invented)",
    async () => {
      await setupTeamEventType({ twOrgId: null });
      const handleNewBooking = getNewBookingHandler();

      const created = await handleNewBooking({ bookingData: bookingRequest() });

      // No explicit value is written, so the column default applies; with no org scope that is NULL.
      const row = await prismaMock.booking.findUnique({ where: { uid: created.uid! } });
      expect(row?.eventTypeId).toBe(1);
      expect(row?.twOrgId ?? null).toBeNull();
    },
    timeout
  );
});
