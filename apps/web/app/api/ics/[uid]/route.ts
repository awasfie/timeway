import type { ICSCalendarEvent } from "@calcom/emails/lib/generateIcsString";
import generateIcsString from "@calcom/emails/lib/generateIcsString";
import { publicLookupsForBookingUid, resolvePublicTwOrgFirst } from "@calcom/lib/server/tw-org-scope/public";
import prisma from "@calcom/prisma";
import { runWithTwOrg } from "@calcom/prisma/tw-org-context";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** Public .ics download keyed by the unguessable booking uid (TW-MAIL-2, Apple/.ics link). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  if (!uid || uid.length < 10) return NextResponse.json({ message: "Not found" }, { status: 404 });
  // TW-T9.2b4: the org is the booking's, resolved from its uid; unresolved is not found.
  const twOrgId = await resolvePublicTwOrgFirst(prisma, publicLookupsForBookingUid(uid));
  if (!twOrgId) return NextResponse.json({ message: "Not found" }, { status: 404 });
  const booking = await runWithTwOrg(twOrgId, () =>
    prisma.booking.findUnique({
      where: { uid },
      select: {
        uid: true,
        iCalUID: true,
        title: true,
        startTime: true,
        endTime: true,
        location: true,
        status: true,
        user: { select: { name: true, email: true, timeZone: true } },
        attendees: { select: { name: true, email: true, timeZone: true } },
      },
    })
  );
  if (!booking || !booking.user || booking.status === "CANCELLED" || booking.status === "REJECTED") {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }
  const person = (p: { name: string | null; email: string; timeZone: string }) => ({
    name: p.name ?? "",
    email: p.email,
    timeZone: p.timeZone,
    language: { translate: ((k: string) => k) as never, locale: "en" },
  });
  const event = {
    uid: booking.uid,
    iCalUID: booking.iCalUID ?? undefined,
    title: booking.title,
    startTime: booking.startTime.toISOString(),
    endTime: booking.endTime.toISOString(),
    location: booking.location,
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
