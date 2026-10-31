import { createHmac, timingSafeEqual } from "node:crypto";

import { verifyButtonPayload, type ButtonAction } from "./payload";
import { normalizePhone } from "./sender";

// WC-TW-10a: inbound quick-reply tap forwarded by Whatsaff -> booking action.
// Body = the INT-4 inbound event shape Whatsaff already builds for SalesOS (interactive_id, senderNumber, ...);
// auth = X-Webhook-Signature-256: sha256=<hex HMAC(body)> with TW_WA_WEBHOOK_SECRET. Every field is untrusted.

export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const given = Buffer.from(header.slice("sha256=".length));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type BookingForAction = {
  uid: string;
  status: string;
  endTime: Date;
  metadata: unknown;
  attendeePhones: string[];
  attendeeEmail: string | null;
};

export type ButtonDeps = {
  findBooking(uid: string): Promise<BookingForAction | null>;
  /** Writes metadata.waConfirmedAt (merging existing metadata). */
  markConfirmed(uid: string, metadata: Record<string, unknown>, at: Date): Promise<void>;
  /** Existing cancel path (handleCancelBooking). */
  cancel(uid: string, attendeeEmail: string | null): Promise<void>;
  rescheduleUrl(uid: string): string;
  /** Free-form session reply to the tapper (best effort). */
  reply(to: string, text: string): Promise<void>;
  now(): Date;
};

export type ButtonOutcome =
  | { status: "ignored"; reason: string }
  | { status: "rejected"; reason: string }
  | { status: "done"; action: ButtonAction; changed: boolean };

const TEXT = {
  confirmed: "Thanks, your booking is confirmed.",
  alreadyConfirmed: "Your booking is already confirmed.",
  cancelled: "Your booking has been cancelled.",
  alreadyCancelled: "This booking is already cancelled.",
  reschedule: (url: string) => `Pick a new time here: ${url}`,
  expired: "This reminder has expired. Please use the link in your booking email.",
} as const;

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export async function handleButtonEvent(event: unknown, secret: string, deps: ButtonDeps): Promise<ButtonOutcome> {
  const ev = asRecord(event);
  const payload = typeof ev.interactive_id === "string" ? ev.interactive_id : null;
  if (!payload?.startsWith("tw:")) return { status: "ignored", reason: "not_timeway" };
  const from = normalizePhone(typeof ev.senderNumber === "string" ? `+${ev.senderNumber.replace(/^\+/, "")}` : null);

  const v = verifyButtonPayload(payload, secret, deps.now());
  if (!v.ok) {
    if (v.reason === "expired" && from) await deps.reply(from, TEXT.expired).catch(() => undefined);
    return { status: "rejected", reason: v.reason };
  }

  const booking = await deps.findBooking(v.bookingUid);
  if (!booking) return { status: "rejected", reason: "booking_not_found" };
  // A forwarded reminder must not let a third party act on the booking.
  const phones = booking.attendeePhones.map(normalizePhone).filter(Boolean);
  if (!from || !phones.includes(from)) return { status: "rejected", reason: "sender_mismatch" };

  const cancelled = booking.status === "CANCELLED" || booking.status === "REJECTED";

  if (v.action === "confirm") {
    if (cancelled) {
      await deps.reply(from, TEXT.alreadyCancelled).catch(() => undefined);
      return { status: "done", action: "confirm", changed: false };
    }
    const meta = asRecord(booking.metadata);
    if (meta.waConfirmedAt) {
      await deps.reply(from, TEXT.alreadyConfirmed).catch(() => undefined);
      return { status: "done", action: "confirm", changed: false };
    }
    await deps.markConfirmed(booking.uid, meta, deps.now());
    await deps.reply(from, TEXT.confirmed).catch(() => undefined);
    return { status: "done", action: "confirm", changed: true };
  }

  if (v.action === "cancel") {
    if (cancelled) {
      await deps.reply(from, TEXT.alreadyCancelled).catch(() => undefined);
      return { status: "done", action: "cancel", changed: false };
    }
    await deps.cancel(booking.uid, booking.attendeeEmail);
    await deps.reply(from, TEXT.cancelled).catch(() => undefined);
    return { status: "done", action: "cancel", changed: true };
  }

  if (cancelled) {
    await deps.reply(from, TEXT.alreadyCancelled).catch(() => undefined);
    return { status: "done", action: "reschedule", changed: false };
  }
  await deps.reply(from, TEXT.reschedule(deps.rescheduleUrl(booking.uid))).catch(() => undefined);
  return { status: "done", action: "reschedule", changed: false };
}
