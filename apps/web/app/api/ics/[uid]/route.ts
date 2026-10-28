import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { metadata as camvMetadata } from "@calcom/app-store/livekitvideo/_metadata";
import generateIcsString from "@calcom/emails/lib/generateIcsString";
import prisma from "@calcom/prisma";
import type { ICSCalendarEvent } from "@calcom/emails/lib/generateIcsString";

/** Public .ics download keyed by the unguessable booking uid (TW-MAIL-2, Apple/.ics link). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  if (!uid || uid.length < 10) return NextResponse.json({ message: "Not found" }, { status: 404 });
  const booking = await prisma.booking.findUnique({
    where: { uid },
    select: {
      uid: true,
      iCalUID: true,
      title: true,
      startTime: true,
      endTime: true,
      location: true,
      status: true,
      references: { select: { type: true, meetingUrl: true } },
      user: { select: { name: true, email: true, timeZone: true } },
      attendees: { select: { name: true, email: true, timeZone: true } },
    },
  });
  if (!booking || !booking.user || booking.status === "CANCELLED" || booking.status === "REJECTED") {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }
  const person = (p: { name: string | null; email: string; timeZone: string }) => ({
    name: p.name ?? "",
    email: p.email,
    timeZone: p.timeZone,
    language: { translate: ((k: string) => k) as never, locale: "en" },
  });
  // TW-ICS-1a: a Camv booking carries its room URL on the livekit_video reference.
  // daily_video refs with an empty meetingUrl are ignored; generateIcsString derives the
  // Camv URL from the uid when no usable reference exists.
  const camvRef = booking.references.find((r) => r.type === camvMetadata.type && r.meetingUrl);
  const event = {
    uid: booking.uid,
    iCalUID: booking.iCalUID ?? undefined,
    title: booking.title,
    startTime: booking.startTime.toISOString(),
    endTime: booking.endTime.toISOString(),
    location: booking.location,
    ...(camvRef?.meetingUrl
      ? { videoCallData: { type: camvRef.type, id: "", password: "", url: camvRef.meetingUrl } }
      : {}),
    organizer: person(booking.user),
    attendees: booking.attendees.map(person),
    type: "",
  } as unknown as ICSCalendarEvent;
  const content = generateIcsString({ event, status: "CONFIRMED" });
  if (!content) return NextResponse.json({ message: "Unavailable" }, { status: 500 });
  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="event.ics"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
