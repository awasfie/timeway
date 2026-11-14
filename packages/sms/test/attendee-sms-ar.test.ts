import { getTranslation } from "@calcom/i18n/server";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import { beforeAll, describe, expect, test, vi } from "vitest";
import AwaitingPaymentSMS from "../attendee/awaiting-payment-sms";
import CancelledSeatSMS from "../attendee/cancelled-seat-sms";
import EventCancelledSMS from "../attendee/event-cancelled-sms";
import EventDeclinedSMS from "../attendee/event-declined-sms";
import EventLocationChangedSMS from "../attendee/event-location-changed-sms";
import EventRequestSMS from "../attendee/event-request-sms";
import EventRequestToRescheduleSMS from "../attendee/event-request-to-reschedule-sms";
import EventSuccessfullyReScheduledSMS from "../attendee/event-rescheduled-sms";
import EventSuccessfullyScheduledSMS from "../attendee/event-scheduled-sms";
import type SMSManager from "../sms-manager";

vi.mock("@calcom/lib/smsLockState");

const en: Record<string, string> = require("@calcom/i18n/locales/en/common.json");
const ar: Record<string, string> = require("@calcom/i18n/locales/ar/common.json");

type SmsClass = new (calEvent: CalendarEvent) => SMSManager;

// mainKeys: keys whose static text must appear in the body; formatsTime: body embeds getFormattedDate.
const CASES: { name: string; Sms: SmsClass; mainKeys: string[]; formatsTime: boolean }[] = [
  {
    name: "awaiting-payment",
    Sms: AwaitingPaymentSMS,
    mainKeys: [
      "meeting_awaiting_payment",
      "complete_your_booking_subject",
      "you_can_view_booking_details_with_this_url",
    ],
    formatsTime: true,
  },
  {
    name: "cancelled-seat",
    Sms: CancelledSeatSMS,
    mainKeys: ["no_longer_attending", "event_no_longer_attending_subject"],
    formatsTime: true,
  },
  {
    name: "event-cancelled",
    Sms: EventCancelledSMS,
    mainKeys: ["hey_there", "event_request_cancelled", "event_cancelled_subject"],
    formatsTime: true,
  },
  {
    name: "event-declined",
    Sms: EventDeclinedSMS,
    mainKeys: ["hey_there", "event_request_declined", "event_declined_subject"],
    formatsTime: true,
  },
  {
    name: "event-location-changed",
    Sms: EventLocationChangedSMS,
    mainKeys: ["event_location_changed", "you_can_view_booking_details_with_this_url"],
    formatsTime: false,
  },
  {
    name: "event-request",
    Sms: EventRequestSMS,
    mainKeys: ["booking_submitted", "user_needs_to_confirm_or_reject_booking"],
    formatsTime: false,
  },
  {
    name: "event-request-to-reschedule",
    Sms: EventRequestToRescheduleSMS,
    mainKeys: ["need_to_reschedule_or_cancel", "request_reschedule_subtitle"],
    formatsTime: false,
  },
  {
    name: "event-rescheduled",
    Sms: EventSuccessfullyReScheduledSMS,
    mainKeys: ["hey_there", "event_type_has_been_rescheduled_on_time_date"],
    formatsTime: true,
  },
  {
    name: "event-scheduled",
    Sms: EventSuccessfullyScheduledSMS,
    mainKeys: ["confirming_your_booking_sms", "you_can_view_booking_details_with_this_url"],
    formatsTime: true,
  },
];

// Static fragments of a template: split on {{var}} and $t(...) so interpolated values don't matter.
const fragments = (value: string) =>
  value
    .split(/\{\{[^}]*\}\}|\$t\([^)]*\)/)
    .map((s) => s.trim().replace(/^[\s.,:،]+|[\s.,:،]+$/g, ""))
    .filter((s) => s.length >= 4);

// English strings that must never leak into an Arabic body: every key that differs between en and ar.
const englishOnlyValues = Object.keys(en)
  .filter((k) => k !== "ADD_NEW_STRINGS_ABOVE_THIS_LINE_TO_PREVENT_MERGE_CONFLICTS")
  .filter((k) => typeof en[k] === "string" && typeof ar[k] === "string" && en[k] !== ar[k])
  .map((k) => en[k])
  .filter((v) => v.length >= 6 && !/\{\{|\$t\(|<|%/.test(v));

const calEvent = {
  uid: "uid-ar-1",
  type: "consult",
  title: "Consultation",
  bookerUrl: "https://book.example.test",
  startTime: "2026-11-05T09:00:00Z",
  endTime: "2026-11-05T09:30:00Z",
  attendees: [],
  organizer: {
    id: 7,
    name: "Org Name",
    email: "org@example.test",
    timeZone: "Asia/Dubai",
    language: { translate: ((k: string) => k) as Person["language"]["translate"], locale: "en" },
  },
} as unknown as CalendarEvent;

const people: Record<"ar" | "en", Person> = {} as Record<"ar" | "en", Person>;

beforeAll(async () => {
  for (const locale of ["ar", "en"] as const) {
    people[locale] = {
      name: "Sara",
      email: "sara@sms.cal.com",
      phoneNumber: "+971500000000",
      timeZone: "Asia/Dubai",
      language: { translate: await getTranslation(locale, "common"), locale },
    } as Person;
  }
});

describe("attendee SMS bodies render in the attendee's language (ar/en)", () => {
  test("fixture has English-only values to check against", () => {
    expect(englishOnlyValues.length).toBeGreaterThan(100);
  });

  for (const { name, Sms, mainKeys, formatsTime } of CASES) {
    describe(name, () => {
      test("ar body contains the ar text of its keys and no English string", () => {
        const body = new Sms(calEvent).getMessage(people.ar);
        for (const key of mainKeys) {
          expect(ar[key], `ar/common.json missing ${key}`).toBeTruthy();
          for (const frag of fragments(ar[key])) expect(body).toContain(frag);
        }
        const leaked = englishOnlyValues.filter((v) => body.includes(v));
        expect(leaked).toEqual([]);
        expect(body).toMatch(/[\u0600-\u06FF]/);
      });

      test("en body contains the en text of its keys and no Arabic", () => {
        const body = new Sms(calEvent).getMessage(people.en);
        for (const key of mainKeys) {
          for (const frag of fragments(en[key])) expect(body).toContain(frag);
        }
        expect(body).not.toMatch(/[\u0600-\u06FF]/);
      });

      if (formatsTime) {
        test("time string is formatted with the ar locale", () => {
          const sms = new Sms(calEvent);
          const arDate = sms.getFormattedDate("Asia/Dubai", "ar");
          const enDate = sms.getFormattedDate("Asia/Dubai", "en");
          // 5 Nov 2026 is a Thursday: الخميس / نوفمبر in ar, Thursday / November in en.
          expect(arDate).toContain("الخميس");
          expect(arDate).toContain("نوفمبر");
          expect(arDate).not.toMatch(/Thursday|November/);
          expect(enDate).toContain("Thursday");
          expect(new Sms(calEvent).getMessage(people.ar)).toContain(arDate);
          expect(new Sms(calEvent).getMessage(people.en)).toContain(enDate);
        });
      }
    });
  }
});
