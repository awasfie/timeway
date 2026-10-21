import { createPublicKey, verify } from "node:crypto";

export const SENDGRID_SIGNATURE_HEADER = "x-twilio-email-event-webhook-signature";
export const SENDGRID_TIMESTAMP_HEADER = "x-twilio-email-event-webhook-timestamp";
export const MAX_SKEW_SECONDS = 300;

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "no_key" | "unsigned" | "bad_timestamp" | "stale" | "bad_signature" };

/**
 * SendGrid Signed Event Webhook: ECDSA P-256 / SHA-256 over `timestamp + rawBody`, signature
 * base64 DER, public key base64 DER SPKI (as shown in the SendGrid settings page).
 * Stale timestamps are rejected so a captured request cannot be replayed later.
 */
export function verifySendgridSignature(input: {
  publicKey: string | undefined;
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
  nowSeconds?: number;
}): SignatureCheck {
  const { publicKey, signature, timestamp, rawBody } = input;
  if (!publicKey) return { ok: false, reason: "no_key" };
  if (!signature || !timestamp) return { ok: false, reason: "unsigned" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale" };

  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
    const valid = verify(
      "sha256",
      Buffer.from(timestamp + rawBody, "utf8"),
      key,
      Buffer.from(signature, "base64")
    );
    return valid ? { ok: true } : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
}
