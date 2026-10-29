import type { ButtonAction } from "./payload";

// WC-TW-10a: one UTILITY template, two languages. Button order is the payload index Meta expects
// at send time (components[].index), so it must match BUTTON_ORDER.
export const REMINDER_TEMPLATE_NAME = "tw_booking_reminder_v1";
export const BUTTON_ORDER: readonly ButtonAction[] = ["confirm", "reschedule", "cancel"];
export type ReminderLang = "en" | "ar";

type TemplateDef = {
  name: string;
  language: ReminderLang;
  category: "UTILITY";
  components: Array<Record<string, unknown>>;
};

const EXAMPLE = ["Sara", "Consultation", "Tue 4 Nov, 10:00 (Asia/Riyadh)"];

const BODY: Record<ReminderLang, string> = {
  en: "Hi {{1}}, this is a reminder of your booking: {{2}} on {{3}}. Please confirm, reschedule or cancel below.",
  ar: "مرحباً {{1}}، نذكّرك بموعدك: {{2}} بتاريخ {{3}}. يرجى التأكيد أو إعادة الجدولة أو الإلغاء من الأزرار أدناه.",
};

export const BUTTON_TEXT: Record<ReminderLang, Record<ButtonAction, string>> = {
  en: { confirm: "Confirm", reschedule: "Reschedule", cancel: "Cancel" },
  ar: { confirm: "تأكيد", reschedule: "إعادة جدولة", cancel: "إلغاء" },
};

const FOOTER: Record<ReminderLang, string> = { en: "Timeway", ar: "Timeway" };

export function reminderTemplate(language: ReminderLang): TemplateDef {
  return {
    name: REMINDER_TEMPLATE_NAME,
    language,
    category: "UTILITY",
    components: [
      { type: "BODY", text: BODY[language], example: { body_text: [EXAMPLE] } },
      { type: "FOOTER", text: FOOTER[language] },
      {
        type: "BUTTONS",
        buttons: BUTTON_ORDER.map((a) => ({ type: "QUICK_REPLY", text: BUTTON_TEXT[language][a] })),
      },
    ],
  };
}

export const ALL_REMINDER_TEMPLATES: TemplateDef[] = [reminderTemplate("en"), reminderTemplate("ar")];

export const pickLang = (locale: string | null | undefined): ReminderLang =>
  (locale ?? "").toLowerCase().startsWith("ar") ? "ar" : "en";

/** Send-time components: 3 body params + one signed payload per quick-reply button, in BUTTON_ORDER. */
export function reminderSendComponents(
  body: { name: string; title: string; when: string },
  payloads: Record<ButtonAction, string>
): Array<Record<string, unknown>> {
  // Meta rejects empty params and newlines/tabs/4+ spaces inside a body parameter.
  const clean = (s: string) => s.replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 200) || "-";
  return [
    {
      type: "body",
      parameters: [body.name, body.title, body.when].map((text) => ({ type: "text", text: clean(text) })),
    },
    ...BUTTON_ORDER.map((a, i) => ({
      type: "button",
      sub_type: "quick_reply",
      index: String(i),
      parameters: [{ type: "payload", payload: payloads[a] }],
    })),
  ];
}
