// L8-6-TW: Timeway packages as published in Bible PART CM.3 (the single source of truth for prices).
// A change here is a CM change; plans.test.ts pins every amount so a drift fails loudly.
export type MarketingPlan = {
  id: "free" | "pro" | "teams" | "business";
  name: string;
  monthly: string;
  yearly: string | null;
  unit: string;
  trial: string;
  cta: string;
  highlights: string[];
};

export const TRIAL_NOTICE =
  "14-day free trial on Pro, card required. Cancel any time before day 14 and you aren't charged.";
export const TAX_NOTICE = "Prices are in USD and include VAT where applicable.";

export const MARKETING_PLANS: MarketingPlan[] = [
  {
    id: "free",
    cta: "Start free",
    name: "Free",
    monthly: "$0",
    yearly: null,
    unit: "1 user",
    trial: "No card needed",
    highlights: [
      "2 event types",
      "1 calendar (Google or Outlook)",
      "Email confirmations + ICS",
      "Embed widget",
    ],
  },
  {
    id: "pro",
    cta: "Start free 14-day trial",
    name: "Pro",
    monthly: "$7",
    yearly: "$70",
    unit: "per user",
    trial: "14-day free trial",
    highlights: [
      "Unlimited event types",
      "Unlimited two-way calendars",
      "Your logo and colours, no badge",
      "Reminders and paid bookings (Stripe)",
    ],
  },
  {
    id: "teams",
    cta: "Get started",
    name: "Teams",
    monthly: "$11",
    yearly: "$110",
    unit: "per user",
    trial: "Buy now",
    highlights: [
      "Round-robin and collective scheduling",
      "Org-wide brand kit",
      "WhatsApp confirmations (200/mo included)",
      "Full workflows, API write",
    ],
  },
  {
    id: "business",
    cta: "Get started",
    name: "Business",
    monthly: "$19",
    yearly: "$190",
    unit: "per user",
    trial: "Buy now",
    highlights: ["Custom booking domain", "WhatsApp 1,000/mo included", "Audit log", "Dedicated support"],
  },
];

export const REGIONAL_FEATURES = [
  "Arabic and right-to-left booking pages",
  "Prayer-aware slot buffers",
  "Ramadan hours templates",
  "Hijri dual dating",
];
