import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCalendarEvent, buildPerson } from "@calcom/lib/test/builder";
import type { CalendarEvent } from "@calcom/types/Calendar";

import generateIcsFile, { GenerateIcsRole } from "./generateIcsFile";
import generateIcsString, { ICS_PRODUCT_ID, getIcsOrganizerEmail } from "./generateIcsString";
import getNextICalSequence, { getICalSequenceForBooking } from "./getICalSequence";
import getICalUID from "./getICalUID";

const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, "");
const prop = (ics: string, name: string) =>
  unfold(ics)
    .split("\r\n")
    .find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

const host = buildPerson({ name: "Host Person", email: "host@example.com", timeZone: "America/New_York" });
const guest = buildPerson({ name: "Guest", email: "guest@example.com", timeZone: "Asia/Dubai" });

const baseEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent =>
  buildCalendarEvent(
    {
      title: "Intro call",
      startTime: "2026-03-08T14:00:00.000Z",
      endTime: "2026-03-08T14:30:00.000Z",
      organizer: host,
      attendees: [guest],
      location: "Office",
      iCalSequence: 0,
      ...overrides,
    },
    true
  );

describe("ICS per WC.2.3", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.EMAIL_FROM = "Timeway <bookings@notify.timeway.co>";
    delete process.env.ICS_ORGANIZER_EMAIL;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("1-3: one UID across create -> reschedule -> cancel with SEQUENCE 0,1,2 and CANCEL semantics", () => {
    const created = { uid: "booking-1", iCalUID: getICalUID({ uid: "booking-1" }), iCalSequence: 0 };
    expect(getICalSequenceForBooking(null)).toBe(0);

    const rescheduled = {
      uid: "booking-2",
      iCalUID: getICalUID({ event: created, uid: "booking-2" }),
      iCalSequence: getICalSequenceForBooking(created),
    };
    const cancelSequence = getNextICalSequence(rescheduled.iCalSequence);

    const icsCreate = generateIcsString({ event: baseEvent(created), status: "CONFIRMED" })!;
    const icsResched = generateIcsString({
      event: baseEvent({ ...rescheduled, startTime: "2026-03-09T14:00:00.000Z", endTime: "2026-03-09T14:30:00.000Z" }),
      status: "CONFIRMED",
    })!;
    const icsCancel = generateIcsString({
      event: baseEvent({ ...rescheduled, iCalSequence: cancelSequence }),
      status: "CANCELLED",
    })!;

    const uids = [icsCreate, icsResched, icsCancel].map((ics) => prop(ics, "UID"));
    expect(new Set(uids).size).toBe(1);
    expect(uids[0]).toBe(`UID:${created.iCalUID}`);
    expect([icsCreate, icsResched, icsCancel].map((ics) => prop(ics, "SEQUENCE"))).toEqual([
      "SEQUENCE:0",
      "SEQUENCE:1",
      "SEQUENCE:2",
    ]);
    expect(prop(icsCancel, "METHOD")).toBe("METHOD:CANCEL");
    expect(prop(icsCancel, "STATUS")).toBe("STATUS:CANCELLED");
  });

  it("2: a pre-sequence booking (null) still increases; location/request-reschedule bump by one", () => {
    expect(getNextICalSequence(null)).toBe(1);
    expect(getNextICalSequence(undefined)).toBe(1);
    expect(getNextICalSequence(4)).toBe(5);
    expect(getICalSequenceForBooking({ iCalSequence: 0 })).toBe(1);
  });

  it("4: ORGANIZER is the sending address with host CN; host is CHAIR attendee; env override wins", () => {
    let ics = unfold(generateIcsString({ event: baseEvent(), status: "CONFIRMED" })!);
    expect(ics).toContain("ORGANIZER;CN=Host Person:mailto:bookings@notify.timeway.co");
    expect(ics).toContain("ATTENDEE;RSVP=FALSE;ROLE=CHAIR;PARTSTAT=ACCEPTED;CN=Host Person:mailto:host@example.com");

    process.env.ICS_ORGANIZER_EMAIL = "invites@notify.timeway.co";
    expect(getIcsOrganizerEmail()).toBe("invites@notify.timeway.co");
    ics = unfold(generateIcsString({ event: baseEvent({ hideOrganizerEmail: true }), status: "CONFIRMED" })!);
    expect(ics).toContain("ORGANIZER;CN=Host Person:mailto:invites@notify.timeway.co");
    expect(ics).not.toContain("host@example.com");
    expect(ics).not.toContain("cal.com");
  });

  it("5: DTSTART/DTEND carry TZID with a VTIMEZONE covering the DST change", () => {
    const ics = unfold(generateIcsString({ event: baseEvent(), status: "CONFIRMED" })!);
    // 2026-03-08 14:00Z is 10:00 EDT, the day US DST starts at 02:00 EST.
    expect(ics).toContain("DTSTART;TZID=America/New_York:20260308T100000");
    expect(ics).toContain("DTEND;TZID=America/New_York:20260308T103000");
    expect(ics).not.toMatch(/DTSTART:\d{8}T\d{6}Z/);
    const vtz = ics.slice(ics.indexOf("BEGIN:VTIMEZONE"), ics.indexOf("END:VTIMEZONE"));
    expect(vtz).toContain("TZID:America/New_York");
    expect(vtz).toContain(
      "BEGIN:DAYLIGHT\r\nDTSTART:20260308T020000\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400\r\nEND:DAYLIGHT"
    );
    expect(vtz).toContain(
      "BEGIN:STANDARD\r\nDTSTART:20261101T020000\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nEND:STANDARD"
    );
    expect(ics.indexOf("END:VTIMEZONE")).toBeLessThan(ics.indexOf("BEGIN:VEVENT"));
  });

  it("5: a zone without DST still gets a VTIMEZONE (Asia/Dubai +0400)", () => {
    const ics = unfold(
      generateIcsString({ event: baseEvent({ organizer: { ...host, timeZone: "Asia/Dubai" } }), status: "CONFIRMED" })!
    );
    expect(ics).toContain("DTSTART;TZID=Asia/Dubai:20260308T180000");
    expect(ics).toContain("TZOFFSETFROM:+0400\r\nTZOFFSETTO:+0400");
  });

  it("6: STATUS/TRANSP/CDO-BUSYSTATUS/PRODID for confirmed, tentative and cancelled", () => {
    const confirmed = generateIcsString({ event: baseEvent(), status: "CONFIRMED" })!;
    expect(prop(confirmed, "PRODID")).toBe(`PRODID:${ICS_PRODUCT_ID}`);
    expect(ICS_PRODUCT_ID).toBe("-//Timeway//Timeway Calendar//EN");
    expect(prop(confirmed, "TRANSP")).toBe("TRANSP:OPAQUE");
    expect(prop(confirmed, "X-MICROSOFT-CDO-BUSYSTATUS")).toBe("X-MICROSOFT-CDO-BUSYSTATUS:BUSY");

    const tentative = generateIcsString({ event: baseEvent(), status: "TENTATIVE" })!;
    expect(prop(tentative, "STATUS")).toBe("STATUS:TENTATIVE");
    expect(prop(tentative, "METHOD")).toBe("METHOD:REQUEST");

    const cancelled = generateIcsString({ event: baseEvent({ iCalSequence: 1 }), status: "CANCELLED" })!;
    expect(prop(cancelled, "TRANSP")).toBe("TRANSP:TRANSPARENT");
    expect(prop(cancelled, "X-MICROSOFT-CDO-BUSYSTATUS")).toBe("X-MICROSOFT-CDO-BUSYSTATUS:FREE");
  });

  it.each([
    ["CONFIRMED", "REQUEST"],
    ["CANCELLED", "CANCEL"],
  ] as const)("7: %s mail carries a text/calendar method=%s part and an invite.ics attachment", async (status, method) => {
    const icalEvent = generateIcsFile({ calEvent: baseEvent(), role: GenerateIcsRole.ATTENDEE, status })!;
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
    const info = await transport.sendMail({
      from: process.env.EMAIL_FROM,
      to: "guest@example.com",
      subject: "Invite",
      html: "<p>hi</p>",
      text: "hi",
      icalEvent,
    });
    const raw = (info.message as Buffer).toString("utf8");
    expect(raw).toContain(`Content-Type: text/calendar; charset=utf-8; method=${method}`);
    expect(raw).toMatch(/Content-Type: application\/ics; name=invite\.ics/);
    expect(raw).toMatch(/Content-Disposition: attachment; filename=invite\.ics/);
    expect(raw).toMatch(/Content-Type: multipart\/alternative/);
  });

  it("8: Arabic SUMMARY/DESCRIPTION stay valid UTF-8 and lines fold at <= 75 octets", () => {
    const arabicTitle = "اجتماع تعريفي مع فريق المبيعات لمناقشة خطة الاشتراك السنوية والتسعير";
    const t = ((key: string) => (key === "what" ? "ماذا" : key)) as unknown as Parameters<
      typeof generateIcsString
    >[0]["t"];
    const ics = generateIcsString({ event: baseEvent({ title: arabicTitle }), status: "CONFIRMED", t })!;
    const lines = ics.split("\r\n");
    for (const line of lines) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(Buffer.from(ics, "utf8").toString("utf8")).toBe(ics);
    expect(ics).not.toContain("\uFFFD");
    expect(prop(ics, "SUMMARY")).toBe(`SUMMARY:${arabicTitle}`);
    expect(unfold(ics)).toContain("ماذا");
  });
});
