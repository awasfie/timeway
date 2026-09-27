import { describe, expect, it } from "vitest";

import { LEGAL_ENTITY, privacyContent, termsContent } from "./content";

// CM-T6 (Bible v12.1): Timeway legal pages. These are the facts the Bible pins; a change here
// is a Bible-level change (PART CM / CM.0-7 / D-R60), so the test fails loudly.
const all = (c: ReturnType<typeof termsContent>): string =>
  [c.intro, ...c.sections.flatMap((s) => [s.heading, ...s.paragraphs, ...(s.bullets ?? [])])].join("\n");

describe("CM-T6 Timeway legal content", () => {
  const terms = all(termsContent("Timeway", "help@timeway.co", "https://timeway.co"));
  const privacy = all(privacyContent("Timeway", "help@timeway.co"));

  it("names the legal entity AWSTREAMS DMCC with the Stripe account's TRN and address", () => {
    expect(LEGAL_ENTITY.name).toBe("AWSTREAMS DMCC");
    expect(LEGAL_ENTITY.trn).toBe("100460677600003");
    expect(LEGAL_ENTITY.address).toContain("Tiffany Tower");
    expect(terms).toContain("AWSTREAMS DMCC");
    expect(terms).toContain("100460677600003");
    expect(privacy).toContain("AWSTREAMS DMCC");
  });

  it("carries the refund rule CM.0-7 verbatim (UX FAQ wording)", () => {
    expect(terms).toContain(
      "Monthly plans aren't refunded; yearly plans are refunded pro-rata within 30 days of the first purchase."
    );
  });

  it("states prices tax-inclusive (D-R60), never '+VAT'", () => {
    expect(terms).toContain("VAT is included where applicable");
    expect(terms).not.toMatch(/\+\s*VAT|plus VAT|excluding VAT/i);
  });

  it("states the trial rule (CM.0-4: 14 days, card up front, charged day 14)", () => {
    expect(terms).toMatch(/14-day free trial/);
    expect(terms).toMatch(/end of day 14/);
  });

  it("matches CM.0-5 trial reminders and CM.0-6 dunning/retention", () => {
    expect(terms).toMatch(/day 7, on day 12, and on day 13/);
    expect(terms).toMatch(/the trial ends/);
    expect(terms).toMatch(/up to 4 times over 7 days/);
    expect(terms).toMatch(/read-only/);
    expect(terms).toMatch(/21 days/);
    expect(terms).toContain("we pause your workspace for 90 days before anything is deleted");
    expect(privacy).toContain("we pause your workspace for 90 days before anything is deleted");
  });

  it("has no cal.com / Cal.diy / upstream-brand leaks", () => {
    for (const t of [terms, privacy]) {
      expect(t).not.toMatch(/cal\.com|cal\.diy|calcom|Timeway, Inc\./i);
    }
  });
});
