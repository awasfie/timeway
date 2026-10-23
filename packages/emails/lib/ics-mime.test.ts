import { buildCalendarEvent, buildPerson } from "@calcom/lib/test/builder";
import { createTransport } from "nodemailer";
import type StreamTransport from "nodemailer/lib/stream-transport";
import { expect, it } from "vitest";
import generateIcsFile, { GenerateIcsRole } from "./generateIcsFile";

const host = buildPerson({ email: "host@example.com", timeZone: "Asia/Dubai" });
const calEvent = buildCalendarEvent({ organizer: host, attendees: [host], iCalSequence: 1 }, true);

it.each([
  ["CONFIRMED", "REQUEST"],
  ["CANCELLED", "CANCEL"],
] as const)("7: %s mail carries text/calendar method=%s plus an invite.ics attachment", async (status, method) => {
  const icalEvent = generateIcsFile({ calEvent, role: GenerateIcsRole.ATTENDEE, status }) ?? undefined;
  const transport = createTransport({ streamTransport: true, buffer: true, newline: "windows" });
  const info: StreamTransport.SentMessageInfo = await transport.sendMail({
    text: "hi",
    html: "hi",
    icalEvent,
  });
  const parts = (info.message as Buffer).toString("utf8").split(/\r\n--/);
  const calendar = parts.filter((p) => p.includes("Content-Type: text/calendar"));
  const attachment = parts.filter((p) => p.includes("Content-Type: application/ics"));
  expect(calendar).toHaveLength(1);
  expect(calendar[0]).toContain(`Content-Type: text/calendar; charset=utf-8; method=${method}`);
  expect(calendar[0]).toContain(`METHOD:${method}`);
  expect(attachment).toHaveLength(1);
  expect(attachment[0]).toContain("Content-Type: application/ics; name=invite.ics");
  expect(attachment[0]).toContain("Content-Disposition: attachment; filename=invite.ics");
  const body = attachment[0].slice(attachment[0].indexOf("\r\n\r\n") + 4).replace(/\s+/g, "");
  expect(Buffer.from(body, "base64").toString("utf8")).toContain(`METHOD:${method}`);
});
