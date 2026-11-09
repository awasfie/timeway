import process from "node:process";
import { resolvePublicTwOrg } from "@calcom/lib/server/tw-org-scope/public";
import prisma from "@calcom/prisma";
import { runWithTwOrg } from "@calcom/prisma/tw-org-context";
import { NextResponse } from "next/server";

/**
 * Internal-only endpoint for Camv (TW-T7) to validate a booking before
 * minting a LiveKit join token. Called server-to-server from the Camv app's
 * own token endpoint — never exposed to browsers directly.
 *
 * Auth: shared secret header (CAMV_INTERNAL_SECRET), NOT a user session —
 * Camv has no Timeway user context at join time (guests aren't Timeway users).
 *
 * Room name convention: tw-<bookingUid> (see packages/app-store/livekitvideo).
 */
export async function GET(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const sharedSecret = process.env.CAMV_INTERNAL_SECRET;
  if (!sharedSecret) {
    return NextResponse.json({ error: "CAMV_INTERNAL_SECRET not configured" }, { status: 500 });
  }
  const authHeader = request.headers.get("x-camv-internal-secret");
  if (authHeader !== sharedSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { uid } = await params;
  if (!uid) {
    return NextResponse.json({ error: "missing uid" }, { status: 400 });
  }

  // TW-T9.2b4: the org is the booking's, resolved from its uid by the SECURITY DEFINER
  // fn (exactly one non-NULL org, else 404). Never from a header or query param.
  const twOrgId = await resolvePublicTwOrg(prisma, { resolver: "booking_uid", keys: [uid] });
  if (!twOrgId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const booking = await runWithTwOrg(twOrgId, () =>
    prisma.booking.findUnique({
      where: { uid },
      select: {
        uid: true,
        title: true,
        startTime: true,
        endTime: true,
        status: true,
        user: {
          select: { name: true, email: true },
        },
        attendees: {
          select: { name: true, email: true },
        },
      },
    })
  );

  if (!booking) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    uid: booking.uid,
    title: booking.title,
    startTime: booking.startTime,
    endTime: booking.endTime,
    status: booking.status,
    host: booking.user ? { name: booking.user.name, email: booking.user.email } : null,
    attendees: booking.attendees.map((a) => ({ name: a.name, email: a.email })),
  });
}
