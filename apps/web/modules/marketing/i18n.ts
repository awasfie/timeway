// FRONT-DOOR-timeway (t_52034498): EN/AR strings of the signed-out front door. No string carries a price:
// amounts come from front-door.generated.ts (passport price-map.md, PART CM). Pricing words follow the
// family site-kit (salesos packages/site-kit/src/pricing-strings.ts) so every product reads the same.
export type FrontLocale = "en" | "ar";
export const FRONT_LOCALES: readonly FrontLocale[] = ["en", "ar"];

export const toFrontLocale = (l: string | null | undefined): FrontLocale =>
  l?.toLowerCase().startsWith("ar") ? "ar" : "en";

/** Path of a front-door page in a locale: EN at the root, AR under /ar. */
export const frontPath = (l: FrontLocale, path: "/" | "/pricing"): string =>
  l === "en" ? path : path === "/" ? "/ar" : `/ar${path}`;

const en = {
  navPricing: "Pricing",
  navLogin: "Log in",
  navStart: "Start free",
  navOtherLang: "العربية",
  footerTerms: "Terms of Service",
  footerPrivacy: "Privacy Policy",
  seePricing: "See pricing",
  regionalTitle: "Made for how the region works",
  regionalLead: "Included free on every plan.",
  pricingTitle: "Pricing",
  pricingLead: "Start free. Upgrade when you need unlimited event types, team scheduling or your own domain.",
  questions: "Questions",
  contactLead: "Questions about a plan or paying by invoice?",
  contactUs: "Contact us",
  perMonthFree: "month",
  perUserMonth: "user/month",
  orYearly: "or {amount} per user/year",
  oneUser: "1 user",
  trialNotice:
    "{days}-day free trial on Pro, card required. Cancel any time before day {days} and you aren't charged.",
  taxNotice: "Prices are in USD and include VAT where applicable.",
  fromPrice: "Plans from {amount} per user a month.",
} as const;

export type FrontKey = keyof typeof en;

const ar: Record<FrontKey, string> = {
  navPricing: "الأسعار",
  navLogin: "تسجيل الدخول",
  navStart: "ابدأ مجاناً",
  navOtherLang: "English",
  footerTerms: "شروط الخدمة",
  footerPrivacy: "سياسة الخصوصية",
  seePricing: "اطّلع على الأسعار",
  regionalTitle: "مصمّم لطريقة عمل المنطقة",
  regionalLead: "مشمول مجاناً في كل الخطط.",
  pricingTitle: "الأسعار",
  pricingLead: "ابدأ مجاناً، ثم رقِّ خطتك عندما تحتاج أنواع مواعيد غير محدودة أو جدولة للفريق أو نطاقك الخاص.",
  questions: "أسئلة شائعة",
  contactLead: "لديك سؤال عن خطة أو تريد الدفع بفاتورة؟",
  contactUs: "تواصل معنا",
  perMonthFree: "شهرياً",
  perUserMonth: "لكل مستخدم شهرياً",
  orYearly: "أو {amount} لكل مستخدم سنوياً",
  oneUser: "مستخدم واحد",
  trialNotice:
    "تجربة مجانية لمدة {days} يوماً على خطة Pro، وتتطلب بطاقة. ألغِ في أي وقت قبل اليوم {days} ولن يُخصم منك شيء.",
  taxNotice: "الأسعار بالدولار الأمريكي وتشمل ضريبة القيمة المضافة حيثما تنطبق.",
  fromPrice: "الخطط تبدأ من {amount} لكل مستخدم شهرياً.",
};

const messages: Record<FrontLocale, Record<FrontKey, string>> = { en, ar };

export function ft(l: FrontLocale, k: FrontKey, vars: Record<string, string | number> = {}): string {
  return messages[l][k].replace(/\{(\w+)\}/g, (_, v: string) => String(vars[v] ?? `{${v}}`));
}

type L10n = Record<FrontLocale, string>;

export const PLAN_COPY: Record<
  "free" | "pro" | "teams" | "business",
  { name: L10n; cta: L10n; trial: L10n; highlights: L10n[] }
> = {
  free: {
    name: { en: "Free", ar: "المجانية" },
    cta: { en: "Start free", ar: "ابدأ مجاناً" },
    trial: { en: "No card needed", ar: "دون بطاقة" },
    highlights: [
      { en: "2 event types", ar: "نوعا مواعيد" },
      { en: "1 calendar (Google or Outlook)", ar: "تقويم واحد (Google أو Outlook)" },
      { en: "Email confirmations + ICS", ar: "تأكيدات بالبريد الإلكتروني + ICS" },
      { en: "Embed widget", ar: "أداة تضمين" },
    ],
  },
  pro: {
    name: { en: "Pro", ar: "Pro" },
    cta: { en: "Start free {days}-day trial", ar: "ابدأ تجربة مجانية لمدة {days} يوماً" },
    trial: { en: "{days}-day free trial", ar: "تجربة مجانية لمدة {days} يوماً" },
    highlights: [
      { en: "Unlimited event types", ar: "أنواع مواعيد غير محدودة" },
      { en: "Unlimited two-way calendars", ar: "تقويمات غير محدودة بمزامنة ثنائية" },
      { en: "Your logo and colours, no badge", ar: "شعارك وألوانك، دون شارة" },
      { en: "Reminders and paid bookings (Stripe)", ar: "تذكيرات وحجوزات مدفوعة (Stripe)" },
    ],
  },
  teams: {
    name: { en: "Teams", ar: "Teams" },
    cta: { en: "Get started", ar: "ابدأ الآن" },
    trial: { en: "Buy now", ar: "اشترِ الآن" },
    highlights: [
      { en: "Round-robin and collective scheduling", ar: "جدولة بالتناوب وجماعية" },
      { en: "Org-wide brand kit", ar: "هوية بصرية موحّدة للمؤسسة" },
      { en: "WhatsApp confirmations (200/mo included)", ar: "تأكيدات واتساب (200 شهرياً مشمولة)" },
      { en: "Full workflows, API write", ar: "مسارات عمل كاملة، وكتابة عبر الواجهة البرمجية" },
    ],
  },
  business: {
    name: { en: "Business", ar: "Business" },
    cta: { en: "Get started", ar: "ابدأ الآن" },
    trial: { en: "Buy now", ar: "اشترِ الآن" },
    highlights: [
      { en: "Custom booking domain", ar: "نطاق حجز خاص" },
      { en: "WhatsApp 1,000/mo included", ar: "1,000 رسالة واتساب شهرياً مشمولة" },
      { en: "Audit log", ar: "سجل التدقيق" },
      { en: "Dedicated support", ar: "دعم مخصّص" },
    ],
  },
};

export const REGIONAL_COPY: L10n[] = [
  { en: "Arabic and right-to-left booking pages", ar: "صفحات حجز بالعربية ومن اليمين إلى اليسار" },
  { en: "Prayer-aware slot buffers", ar: "فواصل زمنية تراعي أوقات الصلاة" },
  { en: "Ramadan hours templates", ar: "قوالب ساعات رمضان" },
  { en: "Hijri dual dating", ar: "التاريخ الهجري بجانب الميلادي" },
];

export const FAQ_COPY: { q: L10n; a: L10n }[] = [
  {
    q: { en: "When am I charged?", ar: "متى يُخصم المبلغ؟" },
    a: {
      en: "Pro starts with a {days}-day free trial. Your card is charged on day {days} unless you cancel first.",
      ar: "تبدأ خطة Pro بتجربة مجانية لمدة {days} يوماً، ويُخصم من بطاقتك في اليوم {days} ما لم تلغِ قبل ذلك.",
    },
  },
  {
    q: { en: "How do I cancel?", ar: "كيف ألغي اشتراكي؟" },
    a: {
      en: "Cancel any time from your billing settings. Monthly plans aren't refunded; yearly plans are refunded pro-rata within 30 days of the first purchase.",
      ar: "ألغِ في أي وقت من إعدادات الفوترة. لا تُسترد الخطط الشهرية؛ وتُسترد الخطط السنوية بالتناسب خلال 30 يوماً من أول شراء.",
    },
  },
  {
    q: { en: "Is there a free plan?", ar: "هل توجد خطة مجانية؟" },
    a: {
      en: "Yes. One user, two event types and one calendar, free for as long as you like.",
      ar: "نعم. مستخدم واحد ونوعا مواعيد وتقويم واحد، مجاناً لأي مدة تريدها.",
    },
  },
];
