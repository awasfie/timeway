import type { TFunction } from "i18next";
import type { Attendee, DateArray, ParticipationRole, EventStatus, ParticipationStatus } from "ics";
import { createEvent } from "ics";
import { RRule } from "rrule";

import { getRichDescription } from "@calcom/lib/CalEventParser";
import { getVideoCallUrlFromCalEvent } from "@calcom/lib/CalEventParser";
import { ORGANIZER_EMAIL_EXEMPT_DOMAINS, WEBSITE_URL } from "@calcom/lib/constants";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import { buildVTimezone, isValidTimeZone, toLocalIcsDateTime } from "./icsTimezone";

export enum BookingAction {
  Create = "create",
  Cancel = "cancel",
  Reschedule = "reschedule",
  RequestReschedule = "request_reschedule",
  LocationChange = "location_change",
}

export type ICSCalendarEvent = Pick<
  CalendarEvent,
  | "uid"
  | "iCalUID"
  | "iCalSequence"
  | "startTime"
  | "endTime"
  | "title"
  | "organizer"
  | "attendees"
  | "location"
  | "recurringEvent"
  | "team"
  | "type"
  | "hideCalendarEventDetails"
  | "hideOrganizerEmail"
>;

export const ICS_PRODUCT_ID = "-//Timeway//Timeway Calendar//EN";

const toICalDateArray = (date: string): DateArray => {
  const d = new Date(date);
  return [
    d.getUTCFullYear(),
    d.getUTCMonth() + 1, // Convert 0-based month to 1-based
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
  ] satisfies DateArray;
};

const extractAddress = (from: string | undefined) => {
  if (!from) return undefined;
  const match = from.match(/<([^>]+)>/);
  const address = (match ? match[1] : from).trim();
  return address.includes("@") ? address : undefined;
};

/** ORGANIZER must be the address the mail is sent from, or clients treat the invite as forged/foreign. */
export const getIcsOrganizerEmail = () =>
  extractAddress(process.env.ICS_ORGANIZER_EMAIL) ||
  extractAddress(process.env.EMAIL_FROM) ||
  extractAddress(process.env.SENDGRID_EMAIL) ||
  `no-reply@${new URL(WEBSITE_URL).hostname.replace(/^www\./, "")}`;

const utf8Length = (s: string) => Buffer.byteLength(s, "utf8");

/** RFC 5545 3.1: fold at 75 octets without splitting a UTF-8 sequence (the ics lib folds by UTF-16 units). */
const foldOctets = (line: string) => {
  const parts: string[] = [];
  let current = "";
  let limit = 75;
  for (const char of line) {
    if (utf8Length(current) + utf8Length(char) > limit) {
      parts.push(current);
      current = "";
      limit = 74;
    }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
};

const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, "").split("\r\n");

type PostProcessInput = { ics: string; event: ICSCalendarEvent; cancelled: boolean; sequence: number };

const postProcess = ({ ics, event, cancelled, sequence }: PostProcessInput) => {
  const timeZone = isValidTimeZone(event.organizer.timeZone) ? event.organizer.timeZone : undefined;
  const out: string[] = [];
  for (const line of unfold(ics)) {
    if (line === "BEGIN:VEVENT" && timeZone) {
      out.push(...buildVTimezone(timeZone, event.startTime, event.endTime));
    }
    const dt = timeZone && /^(DTSTART|DTEND):/.exec(line)?.[1];
    if (dt) {
      const iso = dt === "DTSTART" ? event.startTime : event.endTime;
      out.push(`${dt};TZID=${timeZone}:${toLocalIcsDateTime(timeZone, iso)}`);
      continue;
    }
    out.push(line);
    // The ics lib drops SEQUENCE:0; clients need an explicit baseline to order later updates.
    if (line.startsWith("DTSTAMP:") && sequence === 0) out.push("SEQUENCE:0");
    if (line.startsWith("STATUS:")) out.push(`TRANSP:${cancelled ? "TRANSPARENT" : "OPAQUE"}`);
  }
  return `${out.filter(Boolean).map(foldOctets).join("\r\n")}\r\n`;
};

const generateIcsString = ({
  event,
  status,
  partstat = "ACCEPTED",
  t,
}: {
  event: ICSCalendarEvent;
  status: EventStatus;
  partstat?: ParticipationStatus;
  t?: TFunction;
}): string | undefined => {
  const location = getVideoCallUrlFromCalEvent(event) || event.location;
  const cancelled = status === "CANCELLED";
  const sequence = event.iCalSequence || 0;

  // Taking care of recurrence rule
  let recurrenceRule: string | undefined;
  const icsRole: ParticipationRole = "REQ-PARTICIPANT";
  if (event.recurringEvent?.count) {
    // ics appends "RRULE:" already, so removing it from RRule generated string
    recurrenceRule = new RRule(event.recurringEvent).toString().replace("RRULE:", "");
  }

  const isOrganizerExempt = ORGANIZER_EMAIL_EXEMPT_DOMAINS?.split(",")
    .filter((domain) => domain.trim() !== "")
    .some((domain) => event.organizer.email.toLowerCase().endsWith(domain.toLowerCase()));
  const hideHostEmail = event.hideOrganizerEmail && !isOrganizerExempt;
  const organizerEmail = getIcsOrganizerEmail();

  // Host stays as CHAIR so their own calendar still owns the event (omitted when their email is hidden).
  const hostAttendee: Attendee[] =
    hideHostEmail || event.organizer.email.toLowerCase() === organizerEmail.toLowerCase()
      ? []
      : [
          {
            name: event.organizer.name,
            email: event.organizer.email,
            partstat: "ACCEPTED",
            role: "CHAIR",
            rsvp: false,
          },
        ];

  const icsEvent = createEvent({
    uid: event.iCalUID || event.uid!,
    sequence,
    start: toICalDateArray(event.startTime),
    end: toICalDateArray(event.endTime),
    startInputType: "utc",
    productId: ICS_PRODUCT_ID,
    title: event.title,
    description: getRichDescription(event, t),
    organizer: { name: event.organizer.name, email: organizerEmail },
    ...{ recurrenceRule },
    attendees: [
      ...hostAttendee,
      ...event.attendees.map((attendee: Person) => ({
        name: attendee.name,
        email: attendee.email,
        partstat,
        role: icsRole,
        rsvp: true,
      })),
      ...(event.team?.members
        ? event.team?.members.map((member: Person) => ({
            name: member.name,
            email: member.email,
            partstat,
            role: icsRole,
            rsvp: true,
          }))
        : []),
    ],
    location: location ?? undefined,
    method: cancelled ? "CANCEL" : "REQUEST",
    status,
    ...(event.hideCalendarEventDetails ? { classification: "PRIVATE" } : {}),
    busyStatus: cancelled ? "FREE" : "BUSY",
  });
  if (icsEvent.error) {
    // The ics library throws Yup ValidationError objects (not Error instances) for invalid data like invalid email formats.
    // Convert these to ErrorWithCode.BadRequest so they return 400 instead of falling through to a generic 500.
    if (icsEvent.error.name === "ValidationError") {
      throw new ErrorWithCode(ErrorCode.BadRequest, icsEvent.error.message);
    }
    throw icsEvent.error;
  }
  if (!icsEvent.value) return icsEvent.value;
  return postProcess({ ics: icsEvent.value, event, cancelled, sequence });
};

export default generateIcsString;
