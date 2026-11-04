import { describe, expect, it } from "vitest";
import { MARKETING_PLANS, TAX_NOTICE, TRIAL_NOTICE } from "./plans";

// Amounts are Bible PART CM.3 verbatim; the page may not invent or round a price.
describe("L8-6-TW marketing plans match CM.3", () => {
  const byId = Object.fromEntries(MARKETING_PLANS.map((p) => [p.id, p]));

  it("lists the four CM.3 tiers in order", () => {
    expect(MARKETING_PLANS.map((p) => p.id)).toEqual(["free", "pro", "teams", "business"]);
  });

  it.each([
    ["free", "$0", null],
    ["pro", "$7", "$70"],
    ["teams", "$11", "$110"],
    ["business", "$19", "$190"],
  ])("%s is %s/mo and %s/yr", (id, monthly, yearly) => {
    expect(byId[id].monthly).toBe(monthly);
    expect(byId[id].yearly).toBe(yearly);
  });

  it("puts the trial on Pro only and states tax-inclusive prices", () => {
    expect(MARKETING_PLANS.filter((p) => p.trial.includes("trial")).map((p) => p.id)).toEqual(["pro"]);
    expect(TRIAL_NOTICE).toContain("card required");
    expect(TAX_NOTICE).toContain("include VAT");
    expect(TAX_NOTICE).not.toMatch(/\+\s*VAT/);
  });
});
