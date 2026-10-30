import { createHmac, timingSafeEqual } from "node:crypto";

// WC-TW-10a: quick-reply payload carried by the reminder template buttons.
// Format (fixed by the card): tw:<action>:<bookingUid>:<exp>:<sig>
//   exp = unix seconds; sig = base64url(HMAC-SHA256(secret, "tw:<action>:<bookingUid>:<exp>"))[0..22)
// Meta caps a quick-reply payload at 128 chars (Cal booking uids are ~22 chars, so ~70 in practice).

export const BUTTON_ACTIONS = ["confirm", "reschedule", "cancel"] as const;
export type ButtonAction = (typeof BUTTON_ACTIONS)[number];

const SIG_LEN = 22;
const MAX_LEN = 128;
const UID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const isAction = (v: string): v is ButtonAction => (BUTTON_ACTIONS as readonly string[]).includes(v);

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url").slice(0, SIG_LEN);
}

export function signButtonPayload(
  args: { action: ButtonAction; bookingUid: string; expiresAt: Date },
  secret: string
): string {
  if (!secret) throw new Error("TW_WA_PAYLOAD_SECRET is not set");
  if (!UID_RE.test(args.bookingUid)) throw new Error("bookingUid has characters outside [A-Za-z0-9_-]");
  const exp = Math.floor(args.expiresAt.getTime() / 1000);
  const body = `tw:${args.action}:${args.bookingUid}:${exp}`;
  const out = `${body}:${sign(secret, body)}`;
  if (out.length > MAX_LEN) throw new Error("button payload exceeds 128 chars");
  return out;
}

export type VerifyResult =
  | { ok: true; action: ButtonAction; bookingUid: string; expiresAt: Date }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyButtonPayload(payload: unknown, secret: string, now: Date = new Date()): VerifyResult {
  if (!secret || typeof payload !== "string" || payload.length > MAX_LEN) return { ok: false, reason: "malformed" };
  const parts = payload.split(":");
  if (parts.length !== 5 || parts[0] !== "tw") return { ok: false, reason: "malformed" };
  const [, action, bookingUid, expRaw, sig] = parts;
  if (!isAction(action) || !UID_RE.test(bookingUid) || !/^\d{1,12}$/.test(expRaw)) {
    return { ok: false, reason: "malformed" };
  }
  const expected = Buffer.from(sign(secret, `tw:${action}:${bookingUid}:${expRaw}`));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_signature" };
  }
  const expiresAt = new Date(Number(expRaw) * 1000);
  if (expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, action, bookingUid, expiresAt };
}
