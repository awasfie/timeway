import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import dayjs from "@calcom/dayjs";
import {
  AttendeeBookingReminderEmail,
  HostBookingReminderEmail,
  type ReminderWindow,
} from "@calcom/emails/templates/booking-reminder-email";
import { getCalEventResponses } from "@calcom/features/bookings/lib/getCalEventResponses";
import { getTranslation } from "@calcom/i18n/server";
import prisma from "@calcom/prisma";
import { BookingStatus, ReminderType } from "@calcom/prisma/enums";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

// TW-WF-1: 24 h and 1 h reminders to the attendee and every host. Run every 5 minutes.
const WINDOWS: ReminderWindow[] = [1440, 60];

async function toPerson(p: { name: string | null; email: string; timeZone: string; locale?: string | null }): Promise<Person> {
  const locale = p.locale ?? "en";
  return {
    name: p.name ?? "",
    email: p.email,
    timeZone: p.timeZone,
    language: { translate: await getTranslation(locale, "common"), locale },
  };
}

async function postHandler(request: NextRequest) {
  const apiKey = request.headers.get("authorization") || request.nextUrl.searchParams.get("apiKey");
  if (!process.env.CRON_API_KEY || process.env.CRON_API_KEY !== apiKey) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const now = dayjs();
  const sent: Record<string, number> = {};
  const failures: string[] = [];

  for (const windowMin of WINDOWS) {
    const bookings = await prisma.booking.findMany({
      where: {
        status: BookingStatus.ACCEPTED,
        startTime: { gt: now.toDate(), lte: now.add(windowMin, "minute").toDate() },
      },
      select: {
        id: true,
        uid: true,
        iCalUID: true,
        title: true,
        description: true,
        startTime: true,
        endTime: true,
        createdAt: true,
        location: true,
        responses: true,
        customInputs: true,
        userPrimaryEmail: true,
        user: { select: { id: true, name: true, email: true, timeZone: true, locale: true, username: true } },
        attendees: { select: { name: true, email: true, timeZone: true, locale: true } },
        references: { select: { type: true, meetingUrl: true } },
        eventType: {
          select: {
            id: true,
            slug: true,
            bookingFields: true,
            hosts: {
              select: { user: { select: { id: true, name: true, email: true, timeZone: true, locale: true } } },
            },
          },
        },
      },
    });

    const done = await prisma.reminderMail.findMany({
      where: {
        reminderType: ReminderType.BOOKING_REMINDER,
        elapsedMinutes: windowMin,
        referenceId: { in: bookings.map((b) => b.id) },
      },
      select: { referenceId: true },
    });
    const doneIds = new Set(done.map((d) => d.referenceId));

    for (const booking of bookings) {
      if (doneIds.has(booking.id) || !booking.user) continue;
      // A booking made inside the window never gets that window's reminder (it just got the confirmation).
      if (dayjs(booking.createdAt).isAfter(dayjs(booking.startTime).subtract(windowMin, "minute"))) continue;

      try {
        // Claim first so an overlapping run cannot double-send.
        await prisma.reminderMail.create({
          data: { referenceId: booking.id, reminderType: ReminderType.BOOKING_REMINDER, elapsedMinutes: windowMin },
        });

        const organizer = await toPerson(booking.user);
        const attendees = await Promise.all(booking.attendees.map(toPerson));
        const meetingUrl = booking.references.find((r) => r.meetingUrl)?.meetingUrl;
        const evt = {
          type: booking.eventType?.slug ?? booking.title,
          title: booking.title,
          description: booking.description || undefined,
          ...getCalEventResponses({ bookingFields: booking.eventType?.bookingFields ?? null, booking }),
          location: booking.location ?? "",
          ...(meetingUrl ? { videoCallData: { type: "google_meet_video", id: "", password: "", url: meetingUrl } } : {}),
          startTime: booking.startTime.toISOString(),
          endTime: booking.endTime.toISOString(),
          bookerUrl: "https://timeway.co",
          organizer: { ...organizer, id: booking.user.id, email: booking.userPrimaryEmail ?? booking.user.email },
          attendees,
          uid: booking.uid,
          iCalUID: booking.iCalUID ?? undefined,
        } as unknown as CalendarEvent;

        const sends: Promise<unknown>[] = [];
        for (const a of attendees) sends.push(new AttendeeBookingReminderEmail(evt, a, windowMin).sendEmail());
        sends.push(new HostBookingReminderEmail({ calEvent: evt, window: windowMin }).sendEmail());
        const seen = new Set([evt.organizer.email.toLowerCase()]);
        for (const h of booking.eventType?.hosts ?? []) {
          if (seen.has(h.user.email.toLowerCase())) continue;
          seen.add(h.user.email.toLowerCase());
          sends.push(
            new HostBookingReminderEmail({
              calEvent: evt,
              teamMember: await toPerson(h.user),
              window: windowMin,
            }).sendEmail()
          );
        }
        await Promise.all(sends);
        sent[String(windowMin)] = (sent[String(windowMin)] ?? 0) + 1;
      } catch (e) {
        failures.push(`${booking.uid}:${windowMin}`);
        console.error("sendBookingReminders failed", booking.uid, windowMin, e);
      }
    }
  }

  return NextResponse.json({ sent, failures });
}

export const POST = defaultResponderForAppDir(postHandler);
