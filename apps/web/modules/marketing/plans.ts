// FRONT-DOOR-timeway (t_52034498): Timeway packages for the front door. Every amount is read from
// front-door.generated.ts, which scripts/front-door/gen.mjs builds from passport docs/billing/price-map.md
// (PART CM, tax inclusive). This file types no price; plans.test.ts pins the result against CM.3.
import { TIMEWAY_PRICES } from "./front-door.generated";
import { type FrontLocale, ft, PLAN_COPY, REGIONAL_COPY } from "./i18n";

export type PlanId = "free" | "pro" | "teams" | "business";
export type MarketingPlan = {
  id: PlanId;
  name: string;
  monthly: string;
  yearly: string | null;
  unit: string;
  trial: string;
  cta: string;
  highlights: string[];
};

/** "$7" for 700 cents, "$7.50" for 750: USD list prices, VAT included (D-R60). */
export const formatUsd = (minor: number): string =>
  `$${minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2)}`;

const price = (key: keyof typeof TIMEWAY_PRICES) => TIMEWAY_PRICES[key];

/** Pro's trial length in days, from price-map.md (timeway_pro_monthly). */
export const TRIAL_DAYS = price("timeway_pro_monthly").trialDays ?? 0;
/** The cheapest paid monthly price, shown as "Plans from ..." on the home page. */
export const FROM_PRICE = formatUsd(price("timeway_pro_monthly").amountMinor);

export function marketingPlans(l: FrontLocale = "en"): MarketingPlan[] {
  const days = { days: TRIAL_DAYS };
  const fill = (s: string) => s.replace(/\{days\}/g, String(TRIAL_DAYS));
  const paid = (id: Exclude<PlanId, "free">): MarketingPlan => {
    const c = PLAN_COPY[id];
    return {
      id,
      name: c.name[l],
      monthly: formatUsd(price(`timeway_${id}_monthly`).amountMinor),
      yearly: formatUsd(price(`timeway_${id}_yearly`).amountMinor),
      unit: ft(l, "perUserMonth", days),
      trial: fill(c.trial[l]),
      cta: fill(c.cta[l]),
      highlights: c.highlights.map((h) => h[l]),
    };
  };
  const f = PLAN_COPY.free;
  return [
    {
      id: "free",
      name: f.name[l],
      monthly: formatUsd(0),
      yearly: null,
      unit: ft(l, "oneUser"),
      trial: f.trial[l],
      cta: f.cta[l],
      highlights: f.highlights.map((h) => h[l]),
    },
    paid("pro"),
    paid("teams"),
    paid("business"),
  ];
}

export const MARKETING_PLANS: MarketingPlan[] = marketingPlans("en");
export const trialNotice = (l: FrontLocale) => ft(l, "trialNotice", { days: TRIAL_DAYS });
export const taxNotice = (l: FrontLocale) => ft(l, "taxNotice");
export const TRIAL_NOTICE = trialNotice("en");
export const TAX_NOTICE = taxNotice("en");
export const regionalFeatures = (l: FrontLocale) => REGIONAL_COPY.map((r) => r[l]);
export const REGIONAL_FEATURES = regionalFeatures("en");
