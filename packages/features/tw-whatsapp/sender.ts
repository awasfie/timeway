import process from "node:process";

import { signButtonPayload, type ButtonAction } from "./payload";
import { BUTTON_ORDER, REMINDER_TEMPLATE_NAME, pickLang, reminderSendComponents } from "./templates";

// WC-TW-10a: Timeway -> Whatsaff POST /api/whatsapp/send (x-api-key). Shared sender number by default.
// Env (names only): WHATSAFF_API_URL, WHATSAFF_API_KEY, WHATSAFF_SENDER_PHONE_NUMBER_ID,
// TW_WA_PAYLOAD_SECRET, TW_WA_REMINDER_WINDOWS (minutes, comma list; default "1440").

const TIMEOUT_MS = 8000;

export type WhatsaffConfig = { apiUrl: string; apiKey: string; senderId: string; payloadSecret: string };

export function whatsaffConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsaffConfig | null {
  const apiUrl = env.WHATSAFF_API_URL?.trim();
  const apiKey = env.WHATSAFF_API_KEY?.trim();
  const senderId = env.WHATSAFF_SENDER_PHONE_NUMBER_ID?.trim();
  const payloadSecret = env.TW_WA_PAYLOAD_SECRET?.trim();
  if (!apiUrl || !apiKey || !senderId || !payloadSecret) return null;
  return { apiUrl: apiUrl.replace(/\/+$/, ""), apiKey, senderId, payloadSecret };
}

export function reminderWindowsFromEnv(env: NodeJS.ProcessEnv = process.env): number[] {
  const raw = env.TW_WA_REMINDER_WINDOWS?.trim() || "1440";
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** E.164 digits only; null when the value cannot be a phone number. */
export function normalizePhone(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = v.replace(/[\s\-().]/g, "").replace(/^00/, "+");
  if (!/^\+?\d{8,15}$/.test(d)) return null;
  return d.replace(/^\+/, "");
}

type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function whatsaffSend(
  cfg: WhatsaffConfig,
  body: Record<string, unknown>,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<{ ok: boolean; status: number; messageId?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${cfg.apiUrl}/api/whatsapp/send`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.apiKey },
      body: JSON.stringify({ whatsapp_phone_number_id: cfg.senderId, ...body }),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as { data?: { id?: string; messageId?: string; wa_message_id?: string } };
    return { ok: res.ok, status: res.status, messageId: json?.data?.wa_message_id ?? json?.data?.id ?? json?.data?.messageId };
  } finally {
    clearTimeout(t);
  }
}

export type ReminderBooking = {
  uid: string;
  title: string;
  startTime: Date;
  attendee: { name: string | null; phone: string | null; locale: string | null; timeZone: string };
};

export function formatWhen(start: Date, timeZone: string, lang: "en" | "ar"): string {
  try {
    const s = new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(start);
    return `${s} (${timeZone})`;
  } catch {
    return start.toISOString();
  }
}

/** Builds the Whatsaff send body for one attendee reminder; null when there is no usable phone. */
export function buildReminderSend(b: ReminderBooking, payloadSecret: string): Record<string, unknown> | null {
  const phone = normalizePhone(b.attendee.phone);
  if (!phone) return null;
  const lang = pickLang(b.attendee.locale);
  // Buttons stop working when the meeting starts; a late tap gets the "expired" reply.
  const payloads = Object.fromEntries(
    BUTTON_ORDER.map((action) => [action, signButtonPayload({ action, bookingUid: b.uid, expiresAt: b.startTime }, payloadSecret)])
  ) as Record<ButtonAction, string>;
  return {
    contact_no: phone,
    messageType: "template",
    templateName: REMINDER_TEMPLATE_NAME,
    languageCode: lang,
    templateComponents: reminderSendComponents(
      { name: b.attendee.name || (lang === "ar" ? "عميلنا" : "there"), title: b.title, when: formatWhen(b.startTime, b.attendee.timeZone, lang) },
      payloads
    ),
    // Ledger tag (WC-TW-9d meta_message_ledger.callback_ref -> source "timeway").
    biz_opaque_callback_data: `tw:${b.uid}`,
  };
}

export async function sendWhatsappReminder(
  b: ReminderBooking,
  cfg: WhatsaffConfig | null = whatsaffConfigFromEnv(),
  fetchImpl?: FetchLike
): Promise<"sent" | "skipped" | "failed"> {
  if (!cfg) return "skipped";
  const body = buildReminderSend(b, cfg.payloadSecret);
  if (!body) return "skipped";
  const res = await whatsaffSend(cfg, body, fetchImpl);
  return res.ok ? "sent" : "failed";
}
