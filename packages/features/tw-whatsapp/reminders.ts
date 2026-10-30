import dayjs from "@calcom/dayjs";
import prisma from "@calcom/prisma";
import { BookingStatus, ReminderType } from "@calcom/prisma/enums";

import { buildUsagePayload, gateWhatsappReminder, recordWhatsappReminder } from "./metering";
import { reminderWindowsFromEnv, sendWhatsappReminderWithId, whatsaffConfigFromEnv } from "./sender";

// WC-TW-10a: WhatsApp leg of the TW-WF-1 reminder cron. Same claim table as the email leg; the WhatsApp
// claim uses elapsedMinutes = -window so the two channels never block each other (no schema change).
export const waClaimMinutes = (windowMin: number) => -windowMin;

export async function runWhatsappReminders(now = new Date()): Promise<{ sent: number; skipped: number; failures: string[] }> {
  const cfg = whatsaffConfigFromEnv();
  const out = { sent: 0, skipped: 0, failures: [] as string[] };
  if (!cfg) return out;

  for (const windowMin of reminderWindowsFromEnv()) {
    const bookings = await prisma.booking.findMany({
      where: {
        status: BookingStatus.ACCEPTED,
        startTime: { gt: now, lte: dayjs(now).add(windowMin, "minute").toDate() },
      },
      select: {
        id: true,
        uid: true,
        twOrgId: true,
        title: true,
        startTime: true,
        createdAt: true,
        responses: true,
        attendees: { select: { name: true, phoneNumber: true, locale: true, timeZone: true }, orderBy: { id: "asc" }, take: 1 },
      },
    });
    if (bookings.length === 0) continue;

    const done = await prisma.reminderMail.findMany({
      where: {
        reminderType: ReminderType.BOOKING_REMINDER,
        elapsedMinutes: waClaimMinutes(windowMin),
        referenceId: { in: bookings.map((b) => b.id) },
      },
      select: { referenceId: true },
    });
    const doneIds = new Set(done.map((d) => d.referenceId));

    for (const b of bookings) {
      if (doneIds.has(b.id)) continue;
      if (dayjs(b.createdAt).isAfter(dayjs(b.startTime).subtract(windowMin, "minute"))) continue;
      const a = b.attendees[0];
      if (!a) continue;
      const responses = (b.responses ?? {}) as Record<string, unknown>;
      const phone = a.phoneNumber ?? (typeof responses.attendeePhoneNumber === "string" ? responses.attendeePhoneNumber : null);
      try {
        // WC-TW-10c: CM.3 gate (plan must include WhatsApp) before the claim; off unless TW_WA_METERING_ENABLED.
        const gate = await gateWhatsappReminder({ twOrgId: b.twOrgId, now });
        if (!gate.send) {
          out.skipped++;
          continue;
        }
        await prisma.reminderMail.create({
          data: { referenceId: b.id, reminderType: ReminderType.BOOKING_REMINDER, elapsedMinutes: waClaimMinutes(windowMin) },
        });
        const { result: r, messageId } = await sendWhatsappReminderWithId(
          { uid: b.uid, title: b.title, startTime: b.startTime, attendee: { name: a.name, phone, locale: a.locale, timeZone: a.timeZone } },
          cfg
        );
        if (r === "sent" && gate.metered) {
          await recordWhatsappReminder(buildUsagePayload(gate, { bookingUid: b.uid, windowMin, messageId, at: now }));
        }
        if (r === "sent") out.sent++;
        else if (r === "skipped") out.skipped++;
        else out.failures.push(`${b.uid}:wa:${windowMin}`);
      } catch (e) {
        out.failures.push(`${b.uid}:wa:${windowMin}`);
        console.error("whatsapp reminder failed", b.uid, windowMin, e instanceof Error ? e.message : "error");
      }
    }
  }
  return out;
}
