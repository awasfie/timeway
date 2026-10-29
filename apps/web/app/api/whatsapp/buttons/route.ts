import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import process from "node:process";

import handleCancelBooking from "@calcom/features/bookings/lib/handleCancelBooking";
import { handleButtonEvent, verifyWebhookSignature } from "@calcom/features/tw-whatsapp/buttons";
import { whatsaffConfigFromEnv, whatsaffSend } from "@calcom/features/tw-whatsapp/sender";
import { WEBAPP_URL } from "@calcom/lib/constants";
import prisma from "@calcom/prisma";

// WC-TW-10a: Whatsaff forwards inbound WhatsApp messages here (INT-4 shape, signed with TW_WA_WEBHOOK_SECRET).
// Only tw: quick-reply payloads act; everything else is acknowledged and ignored. Synchronous, so the state
// change lands inside the inbound delivery (well under the 60 s target).

async function postHandler(request: NextRequest) {
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get("x-webhook-signature-256"), process.env.TW_WA_WEBHOOK_SECRET)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }
  const payloadSecret = process.env.TW_WA_PAYLOAD_SECRET;
  if (!payloadSecret) return NextResponse.json({ status: "ignored", reason: "not_configured" });

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const cfg = whatsaffConfigFromEnv();
  const outcome = await handleButtonEvent(event, payloadSecret, {
    now: () => new Date(),
    findBooking: async (uid) => {
      const b = await prisma.booking.findUnique({
        where: { uid },
        select: {
          uid: true,
          status: true,
          endTime: true,
          metadata: true,
          responses: true,
          attendees: { select: { email: true, phoneNumber: true }, orderBy: { id: "asc" } },
        },
      });
      if (!b) return null;
      const responses = (b.responses ?? {}) as Record<string, unknown>;
      const phones = [
        ...b.attendees.map((a) => a.phoneNumber),
        typeof responses.attendeePhoneNumber === "string" ? responses.attendeePhoneNumber : null,
      ].filter((p): p is string => !!p);
      return {
        uid: b.uid,
        status: b.status,
        endTime: b.endTime,
        metadata: b.metadata,
        attendeePhones: phones,
        attendeeEmail: b.attendees[0]?.email ?? null,
      };
    },
    // Conditional jsonb merge: two concurrent taps write one timestamp, other metadata keys survive.
    markConfirmed: async (uid, _meta, at) => {
      await prisma.$executeRaw`
        UPDATE "Booking"
        SET "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object('waConfirmedAt', ${at.toISOString()}::text)
        WHERE "uid" = ${uid} AND NOT (COALESCE("metadata", '{}'::jsonb) ? 'waConfirmedAt')`;
    },
    cancel: async (uid, attendeeEmail) => {
      try {
        await handleCancelBooking({
          bookingData: {
            uid,
            cancellationReason: "Cancelled via WhatsApp reminder",
            skipCancellationReasonValidation: true,
            ...(attendeeEmail ? { cancelledBy: attendeeEmail } : {}),
          },
          userId: -1,
          actionSource: "whatsapp_reminder",
        });
      } catch (e) {
        // A concurrent tap already cancelled it; the end state is what the attendee asked for.
        const refreshed = await prisma.booking.findUnique({ where: { uid }, select: { status: true } });
        if (refreshed?.status !== "CANCELLED") throw e;
      }
    },
    rescheduleUrl: (uid) => `${WEBAPP_URL}/reschedule/${uid}`,
    reply: async (to, text) => {
      if (!cfg) return;
      await whatsaffSend(cfg, { contact_no: to, messageType: "text", messageText: text });
    },
  });

  return NextResponse.json(outcome);
}

export const POST = defaultResponderForAppDir(postHandler);
