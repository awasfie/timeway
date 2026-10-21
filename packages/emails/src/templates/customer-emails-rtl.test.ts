import { getTranslation } from "@calcom/i18n/server";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import type { TFunction } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import { getCalendarLinks } from "../../lib/calendarLinks";
import { getEmailDirection, getLocaleFromT } from "../../lib/emailDirection";
import renderEmail from "../renderEmail";

const en: Record<string, string> = require("@calcom/i18n/locales/en/common.json");
const ar: Record<string, string> = require("@calcom/i18n/locales/ar/common.json");

let tEn: TFunction;
let tAr: TFunction;

beforeAll(async () => {
  tEn = await getTranslation("en", "common");
  tAr = await getTranslation("ar", "common");
});

const person = (locale: "en" | "ar", email: string, name: string): Person => ({
  name,
  email,
  timeZone: "Asia/Dubai",
  language: { translate: locale === "ar" ? tAr : tEn, locale },
});

function calEvent(attendee: Person, organizer: Person): CalendarEvent {
  return {
    type: "intro",
    title: "Intro call",
    startTime: "2026-11-02T08:00:00Z",
    endTime: "2026-11-02T08:30:00Z",
    uid: "abcDEF1234567890",
    bookerUrl: "https://timeway.co",
    location: "https://meet.google.com/abc-defg-hij",
    organizer,
    attendees: [attendee],
    paymentInfo: {
      link: "https://pay.example/x",
      amount: 10000,
      currency: "aed",
      paymentOption: "ON_BOOKING",
    },
  } as unknown as CalendarEvent;
}

// Keys whose AR value differs from EN and is long enough to be a meaningful leak signal.
const translated = Object.keys(ar).filter(
  (k) => typeof en[k] === "string" && en[k] !== ar[k] && en[k].length >= 6 && !/[{<]/.test(en[k])
);

function leakedEnglish(html: string, keys: string[]) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'");
  return keys.filter((k) => text.includes(en[k]));
}

const bookingTemplates = [
  "AttendeeScheduledEmail",
  "AttendeeRescheduledEmail",
  "AttendeeCancelledEmail",
  "AttendeeRequestEmail",
  "AttendeeDeclinedEmail",
  "AttendeeAwaitingPaymentEmail",
  "AttendeeLocationChangeEmail",
] as const;

async function renderBooking(name: (typeof bookingTemplates)[number] | "Reminder", locale: "en" | "ar") {
  const attendee = person(locale, "guest@example.com", "Guest");
  const organizer = person("en", "host@example.com", "Host");
  const evt = calEvent(attendee, organizer);
  if (name === "Reminder") {
    return renderEmail("AttendeeScheduledEmail", {
      calEvent: evt,
      attendee,
      title: "tw_reminder_title_24h",
      subject: "tw_reminder_title_24h",
    });
  }
  return renderEmail(name, { calEvent: evt, attendee });
}

describe("customer emails: lang/dir from recipient locale (R1-TW-AREN-c)", () => {
  it("getEmailDirection maps RTL languages", () => {
    expect(getEmailDirection("ar")).toBe("rtl");
    expect(getEmailDirection("ar-AE")).toBe("rtl");
    expect(getEmailDirection("he")).toBe("rtl");
    expect(getEmailDirection("fa")).toBe("rtl");
    expect(getEmailDirection("ur")).toBe("rtl");
    expect(getEmailDirection("en")).toBe("ltr");
    expect(getEmailDirection(undefined)).toBe("ltr");
  });

  it("getLocaleFromT reads the fixed-T language", () => {
    expect(getLocaleFromT(tAr)).toBe("ar");
    expect(getLocaleFromT(tEn)).toBe("en");
  });

  for (const name of [...bookingTemplates, "Reminder"] as const) {
    it(`${name}: ar is rtl with no English leak; en is ltr`, async () => {
      const htmlAr = await renderBooking(name, "ar");
      expect(htmlAr).toMatch(/<html[^>]*lang="ar"[^>]*dir="rtl"/);
      expect(htmlAr).not.toContain('dir="ltr"');
      expect(htmlAr).toContain("text-align:right;direction:rtl");
      expect(htmlAr).not.toContain(">Link<");
      expect(leakedEnglish(htmlAr, translated)).toEqual([]);
      expect(htmlAr).not.toContain("Add to calendar");

      const htmlEn = await renderBooking(name, "en");
      expect(htmlEn).toMatch(/<html[^>]*lang="en"[^>]*dir="ltr"/);
      expect(htmlEn).not.toContain('dir="rtl"');
    });
  }

  it("Reminder: ar body carries the Arabic 24h title", async () => {
    expect(await renderBooking("Reminder", "ar")).toContain(ar.tw_reminder_title_24h);
  });

  it("AttendeeWasRequestedToRescheduleEmail: ar CTA translated", async () => {
    for (const locale of ["ar", "en"] as const) {
      const attendee = person(locale, "guest@example.com", "Guest");
      const organizer = person(locale, "host@example.com", "Host");
      const html = await renderEmail("AttendeeWasRequestedToRescheduleEmail", {
        calEvent: calEvent(attendee, organizer),
        attendee,
        metadata: { rescheduleLink: "https://timeway.co/reschedule/abc" },
      });
      expect(html).toMatch(
        new RegExp(`<html[^>]*lang="${locale}"[^>]*dir="${locale === "ar" ? "rtl" : "ltr"}"`)
      );
      if (locale === "ar") {
        expect(html).toContain(ar.book_a_new_time);
        expect(html).not.toContain("Book a new time");
        expect(leakedEnglish(html, translated)).toEqual([]);
      } else {
        expect(html).toContain("Book a new time");
      }
    }
  });

  const authCases = [
    [
      "ForgotPasswordEmail",
      { user: { name: "Guest", email: "g@example.com" }, resetLink: "https://timeway.co/r" },
    ],
    [
      "VerifyAccountEmail",
      { user: { name: "Guest", email: "g@example.com" }, verificationEmailLink: "https://timeway.co/v" },
    ],
    [
      "VerifyEmailByCode",
      { user: { name: "Guest", email: "g@example.com" }, verificationEmailCode: "123456" },
    ],
  ] as const;

  for (const [name, extra] of authCases) {
    it(`${name}: ar is rtl with no English leak; en is ltr`, async () => {
      const htmlAr = await renderEmail(name, { ...extra, language: tAr } as never);
      expect(htmlAr).toMatch(/<html[^>]*lang="ar"[^>]*dir="rtl"/);
      expect(leakedEnglish(htmlAr, translated)).toEqual([]);
      const htmlEn = await renderEmail(name, { ...extra, language: tEn } as never);
      expect(htmlEn).toMatch(/<html[^>]*lang="en"[^>]*dir="ltr"/);
    });
  }

  it(".ics / calendar link details use the recipient language", () => {
    const evt = calEvent(person("ar", "g@example.com", "G"), person("en", "h@example.com", "H"));
    const arLinks = getCalendarLinks(evt, tAr);
    expect(decodeURIComponent(arLinks.google.replace(/\+/g, " "))).toContain(`${ar.join_meeting}:`);
    expect(arLinks.google).not.toContain("Join%3A");
    expect(decodeURIComponent(getCalendarLinks(evt, tEn).google.replace(/\+/g, " "))).toContain(
      `${en.join_meeting}:`
    );
  });
});
