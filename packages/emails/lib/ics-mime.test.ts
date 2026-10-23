import { buildCalendarEvent, buildPerson } from "@calcom/lib/test/builder";
import { createTransport } from "nodemailer";
import type StreamTransport from "nodemailer/lib/stream-transport";
import { describe, expect, it } from "vitest";
import generateIcsFile, { GenerateIcsRole } from "./generateIcsFile";

const calEvent = buildCalendarEvent(
  {
    title: "Intro call",
    startTime: "2026-03-08T14:00:00.000Z",
    endTime: "2026-03-08T14:30:00.000Z",
    organizer: buildPerson({ name: "Host", email: "host@example.com", timeZone: "Asia/Dubai" }),
    attendees: [buildPerson({ name: "Guest", email: "guest@example.com", timeZone: "Asia/Dubai" })],
    iCalSequence: 1,
  },
  true
);

const render = async (status: "CONFIRMED" | "CANCELLED") => {
  const icalEvent = generateIcsFile({ calEvent, role: GenerateIcsRole.ATTENDEE, status }) ?? undefined;
  const transport = createTransport({ streamTransport: true, buffer: true, newline: "windows" });
  const info: StreamTransport.SentMessageInfo = await transport.sendMail({
    from: "Timeway <bookings@notify.timeway.co>",
    to: "guest@example.com",
    subject: "Invite",
    html: "<p>hi</p>",
    text: "hi",
    icalEvent,
  });
  return (info.message as Buffer).toString("utf8");
};

const partHeaders = (raw: string) =>
  raw
    .split(/\r\n--/)
    .map((part) => part.slice(0, part.indexOf("\r\n\r\n")).replace(/\r\n[ \t]+/g, " "))
    .filter((headers) => /Content-Type:/i.test(headers));

describe("ICS MIME per WC.2.3 decision 7", () => {
  it.each([
    ["CONFIRMED", "REQUEST"],
    ["CANCELLED", "CANCEL"],
  ] as const)("7: %s mail has a text/calendar method=%s alternative and an invite.ics attachment", async (status, method) => {
    const raw = await render(status);
    const parts = partHeaders(raw);

    const alternative = parts.filter((h) => /Content-Type: text\/calendar/i.test(h));
    expect(alternative).toHaveLength(1);
    expect(alternative[0]).toMatch(
      new RegExp(`Content-Type: text/calendar; charset=utf-8; method=${method}`, "i")
    );
    expect(alternative[0]).not.toMatch(/Content-Disposition: attachment/i);

    const attachment = parts.filter((h) => /Content-Type: application\/ics/i.test(h));
    expect(attachment).toHaveLength(1);
    expect(attachment[0]).toMatch(/name=invite\.ics/i);
    expect(attachment[0]).toMatch(/Content-Disposition: attachment; filename=invite\.ics/i);

    expect(raw).toMatch(/Content-Type: multipart\/alternative/i);
    expect(raw).toMatch(/Content-Type: multipart\/mixed/i);

    const bodies = raw
      .split(/\r\n--/)
      .filter((p) => /Content-Type: (text\/calendar|application\/ics)/i.test(p));
    for (const body of bodies) {
      const encoded = body.slice(body.indexOf("\r\n\r\n") + 4).replace(/\s+/g, "");
      const decoded = /base64/i.test(body)
        ? Buffer.from(encoded, "base64").toString("utf8")
        : body.slice(body.indexOf("\r\n\r\n") + 4);
      expect(decoded).toContain(`METHOD:${method}`);
    }
  });
});
