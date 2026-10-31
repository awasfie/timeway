import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { handleButtonEvent, verifyWebhookSignature, type BookingForAction, type ButtonDeps } from "./buttons";
import { signButtonPayload, verifyButtonPayload } from "./payload";
import { buildReminderSend, normalizePhone, sendWhatsappReminder, whatsaffConfigFromEnv } from "./sender";
import { ALL_REMINDER_TEMPLATES, BUTTON_ORDER, pickLang, reminderSendComponents } from "./templates";
import committedMetaTemplates from "./templates.meta.json";

const SECRET = "test-secret-not-real";
const NOW = new Date("2026-11-01T08:00:00Z");
const START = new Date("2026-11-02T08:00:00Z");
const UID = "bk_8Xq2LmNp4RtV9wYz1aBcD";

describe("payload sign/verify", () => {
  it("round-trips every action in the fixed format", () => {
    for (const action of BUTTON_ORDER) {
      const p = signButtonPayload({ action, bookingUid: UID, expiresAt: START }, SECRET);
      expect(p).toMatch(new RegExp(`^tw:${action}:${UID}:${START.getTime() / 1000}:[A-Za-z0-9_-]{22}$`));
      expect(p.length).toBeLessThanOrEqual(128);
      expect(verifyButtonPayload(p, SECRET, NOW)).toEqual({ ok: true, action, bookingUid: UID, expiresAt: START });
    }
  });

  it("rejects tampered action, uid, expiry and wrong secret", () => {
    const p = signButtonPayload({ action: "confirm", bookingUid: UID, expiresAt: START }, SECRET);
    const [, , uid, exp, sig] = p.split(":");
    expect(verifyButtonPayload(`tw:cancel:${uid}:${exp}:${sig}`, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyButtonPayload(`tw:confirm:other_uid:${exp}:${sig}`, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyButtonPayload(`tw:confirm:${uid}:${Number(exp) + 3600}:${sig}`, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyButtonPayload(p, "other-secret", NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects expired and malformed payloads", () => {
    const p = signButtonPayload({ action: "confirm", bookingUid: UID, expiresAt: START }, SECRET);
    expect(verifyButtonPayload(p, SECRET, START)).toEqual({ ok: false, reason: "expired" });
    for (const bad of ["", "tw:confirm", "xx:confirm:a:1:b", "tw:delete:a:1:b", "tw:confirm:a b:1:s", "tw:confirm:a:abc:s", 42, null, "x".repeat(200)]) {
      expect(verifyButtonPayload(bad, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
    }
    expect(verifyButtonPayload(p, "", NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses to sign without a secret or with an unsafe uid", () => {
    expect(() => signButtonPayload({ action: "confirm", bookingUid: UID, expiresAt: START }, "")).toThrow();
    expect(() => signButtonPayload({ action: "confirm", bookingUid: "a:b", expiresAt: START }, SECRET)).toThrow();
  });
});

describe("templates", () => {
  it("EN and AR are UTILITY with confirm/reschedule/cancel quick replies in order", () => {
    expect(ALL_REMINDER_TEMPLATES.map((t) => t.language)).toEqual(["en", "ar"]);
    for (const t of ALL_REMINDER_TEMPLATES) {
      expect(t.category).toBe("UTILITY");
      const buttons = t.components.find((c) => c.type === "BUTTONS")?.buttons as Array<{ type: string; text: string }>;
      expect(buttons).toHaveLength(3);
      expect(buttons.every((b) => b.type === "QUICK_REPLY" && b.text.length <= 25)).toBe(true);
      const body = t.components.find((c) => c.type === "BODY") as { text: string };
      expect(body.text.match(/\{\{\d\}\}/g)).toEqual(["{{1}}", "{{2}}", "{{3}}"]);
    }
  });

  it("send components carry one payload per button at the matching index", () => {
    const c = reminderSendComponents({ name: "A\nB", title: "T", when: "" }, { confirm: "p0", reschedule: "p1", cancel: "p2" });
    expect(c[0]).toEqual({ type: "body", parameters: [{ type: "text", text: "A B" }, { type: "text", text: "T" }, { type: "text", text: "-" }] });
    expect(c.slice(1)).toEqual([0, 1, 2].map((i) => ({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload: `p${i}` }] })));
  });

  it("picks Arabic only for ar locales", () => {
    expect(pickLang("ar")).toBe("ar");
    expect(pickLang("ar-SA")).toBe("ar");
    expect(pickLang("en")).toBe("en");
    expect(pickLang(null)).toBe("en");
  });
});

describe("sender", () => {
  const cfg = { apiUrl: "https://wa.example", apiKey: "k", senderId: "sender-1", payloadSecret: SECRET };
  const booking = { uid: UID, title: "Consultation", startTime: START, attendee: { name: "Sara", phone: "+966 50 123 4567", locale: "ar", timeZone: "Asia/Riyadh" } };

  it("config is null unless all four env names are set", () => {
    expect(whatsaffConfigFromEnv({})).toBeNull();
    expect(whatsaffConfigFromEnv({ WHATSAFF_API_URL: "https://x/", WHATSAFF_API_KEY: "k", WHATSAFF_SENDER_PHONE_NUMBER_ID: "s", TW_WA_PAYLOAD_SECRET: "p" })).toEqual({ apiUrl: "https://x", apiKey: "k", senderId: "s", payloadSecret: "p" });
  });

  it("normalizes phones", () => {
    expect(normalizePhone("+966 50 123 4567")).toBe("966501234567");
    expect(normalizePhone("00971501234567")).toBe("971501234567");
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it("builds an AR template send with ledger tag and verifiable payloads", () => {
    const body = buildReminderSend(booking, SECRET)!;
    expect(body).toMatchObject({ contact_no: "966501234567", messageType: "template", templateName: "tw_booking_reminder_v1", languageCode: "ar", biz_opaque_callback_data: `tw:${UID}` });
    const comps = body.templateComponents as Array<{ parameters: Array<{ payload?: string }> }>;
    const actions = comps.slice(1).map((c) => verifyButtonPayload(c.parameters[0].payload, SECRET, NOW));
    expect(actions.map((a) => a.ok && a.action)).toEqual(["confirm", "reschedule", "cancel"]);
  });

  it("skips without phone or config, posts x-api-key to /api/whatsapp/send", async () => {
    expect(await sendWhatsappReminder({ ...booking, attendee: { ...booking.attendee, phone: null } }, cfg)).toBe("skipped");
    expect(await sendWhatsappReminder(booking, null)).toBe("skipped");
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { id: "m1" } }) }));
    expect(await sendWhatsappReminder(booking, cfg, f)).toBe("sent");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://wa.example/api/whatsapp/send");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(JSON.parse(init.body as string).whatsapp_phone_number_id).toBe("sender-1");
    const bad = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(await sendWhatsappReminder(booking, cfg, bad)).toBe("failed");
  });
});

describe("button handler mapping", () => {
  const phone = "966501234567";
  function deps(over: Partial<BookingForAction> = {}) {
    const b: BookingForAction = { uid: UID, status: "ACCEPTED", endTime: START, metadata: { a: 1 }, attendeePhones: ["+966 50 123 4567"], attendeeEmail: "s@example.com", ...over };
    const d = {
      findBooking: vi.fn(async (uid: string) => (uid === UID ? b : null)),
      markConfirmed: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      rescheduleUrl: (uid: string) => `https://timeway.co/reschedule/${uid}`,
      reply: vi.fn(async () => undefined),
      now: () => NOW,
    } satisfies ButtonDeps;
    return d;
  }
  const ev = (action: "confirm" | "reschedule" | "cancel", from = phone) => ({
    interactive_id: signButtonPayload({ action, bookingUid: UID, expiresAt: START }, SECRET),
    senderNumber: from,
  });

  it("confirm sets the flag once (idempotent)", async () => {
    const d = deps();
    expect(await handleButtonEvent(ev("confirm"), SECRET, d)).toEqual({ status: "done", action: "confirm", changed: true });
    expect(d.markConfirmed).toHaveBeenCalledWith(UID, { a: 1 }, NOW);
    const d2 = deps({ metadata: { waConfirmedAt: NOW.toISOString() } });
    expect(await handleButtonEvent(ev("confirm"), SECRET, d2)).toEqual({ status: "done", action: "confirm", changed: false });
    expect(d2.markConfirmed).not.toHaveBeenCalled();
  });

  it("cancel maps to the cancel handler once; already-cancelled is a no-op", async () => {
    const d = deps();
    expect(await handleButtonEvent(ev("cancel"), SECRET, d)).toEqual({ status: "done", action: "cancel", changed: true });
    expect(d.cancel).toHaveBeenCalledWith(UID, "s@example.com");
    const d2 = deps({ status: "CANCELLED" });
    expect(await handleButtonEvent(ev("cancel"), SECRET, d2)).toEqual({ status: "done", action: "cancel", changed: false });
    expect(d2.cancel).not.toHaveBeenCalled();
  });

  it("reschedule replies with the existing reschedule page", async () => {
    const d = deps();
    expect(await handleButtonEvent(ev("reschedule"), SECRET, d)).toEqual({ status: "done", action: "reschedule", changed: false });
    expect(d.reply).toHaveBeenCalledWith(phone, `Pick a new time here: https://timeway.co/reschedule/${UID}`);
  });

  it("ignores non-timeway messages and rejects forged, expired, unknown or foreign-sender taps", async () => {
    const d = deps();
    expect(await handleButtonEvent({ interactive_id: "status_confirm", senderNumber: phone }, SECRET, d)).toEqual({ status: "ignored", reason: "not_timeway" });
    expect(await handleButtonEvent({ textContent: "hi" }, SECRET, d)).toEqual({ status: "ignored", reason: "not_timeway" });
    expect(await handleButtonEvent(null, SECRET, d)).toEqual({ status: "ignored", reason: "not_timeway" });
    expect(await handleButtonEvent(ev("confirm"), "other", d)).toEqual({ status: "rejected", reason: "bad_signature" });
    expect(await handleButtonEvent(ev("cancel", "971500000000"), SECRET, d)).toEqual({ status: "rejected", reason: "sender_mismatch" });
    const late = { ...d, now: () => START };
    expect(await handleButtonEvent(ev("cancel"), SECRET, late)).toEqual({ status: "rejected", reason: "expired" });
    const other = signButtonPayload({ action: "cancel", bookingUid: "missing", expiresAt: START }, SECRET);
    expect(await handleButtonEvent({ interactive_id: other, senderNumber: phone }, SECRET, d)).toEqual({ status: "rejected", reason: "booking_not_found" });
    expect(d.cancel).not.toHaveBeenCalled();
    expect(d.markConfirmed).not.toHaveBeenCalled();
  });
});

describe("webhook signature", () => {
  it("accepts only the INT-4 sha256 header for the exact body", () => {
    const body = '{"a":1}';
    const sig = `sha256=${createHmac("sha256", "whs").update(body).digest("hex")}`;
    expect(verifyWebhookSignature(body, sig, "whs")).toBe(true);
    expect(verifyWebhookSignature(`${body} `, sig, "whs")).toBe(false);
    expect(verifyWebhookSignature(body, sig, undefined)).toBe(false);
    expect(verifyWebhookSignature(body, null, "whs")).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=00", "whs")).toBe(false);
  });
});

describe("Meta submission payloads", () => {
  it("templates.meta.json matches the template definitions", () => {
    expect(committedMetaTemplates).toEqual(ALL_REMINDER_TEMPLATES);
  });
});
