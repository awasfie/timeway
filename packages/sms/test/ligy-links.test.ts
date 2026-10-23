import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import { describe, expect, it, vi } from "vitest";
import EventSuccessfullyReScheduledSMS from "../attendee/event-rescheduled-sms";
import EventSuccessfullyScheduledSMS from "../attendee/event-scheduled-sms";

vi.mock("@calcom/lib/smsLockState");

const t = ((_k: string, o?: { url?: string }) => o?.url ?? "") as unknown as Person["language"]["translate"];
const guest = {
  name: "G",
  email: "Guest@Example.com",
  timeZone: "UTC",
  language: { translate: t, locale: "en" },
} as Person;
const base = {
  uid: "uid-1",
  type: "30min",
  title: "Demo",
  bookerUrl: "https://timeway.test",
  startTime: "2026-10-22T10:00:00Z",
  endTime: "2026-10-22T10:30:00Z",
  organizer: { ...guest, email: "host@timeway.test" },
  attendees: [guest],
} as unknown as CalendarEvent;

describe("LK-T6a: booking SMS uses the li.gy link when composed", () => {
  for (const Sms of [EventSuccessfullyScheduledSMS, EventSuccessfullyReScheduledSMS]) {
    it(`${Sms.name}: li.gy override`, () => {
      const ev = { ...base, ligyLinks: { "guest@example.com": { booking: "https://li.gy/abc" } } };
      expect(new Sms(ev).getMessage(guest)).toContain("https://li.gy/abc");
    });
    it(`${Sms.name}: long URL without override (flag off / Ligy down)`, () => {
      const msg = new Sms(base).getMessage(guest);
      expect(msg).toContain("https://timeway.test/booking/uid-1");
      expect(msg).not.toContain("li.gy");
    });
  }
});
