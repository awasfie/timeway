import { describe, expect, it } from "vitest";
describe("CM-T6 link constants (no env)", () => {
  it("default to timeway.co/terms and /privacy", async () => {
    delete process.env.NEXT_PUBLIC_WEBSITE_TERMS_URL;
    delete process.env.NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL;
    delete process.env.NEXT_PUBLIC_WEBSITE_URL;
    const c = await import("@calcom/lib/constants");
    console.log(
      "TERMS",
      c.WEBSITE_TERMS_URL,
      "PRIVACY",
      c.WEBSITE_PRIVACY_POLICY_URL,
      "COMPANY",
      c.COMPANY_NAME
    );
    expect(c.WEBSITE_TERMS_URL).toBe("https://timeway.co/terms");
    expect(c.WEBSITE_PRIVACY_POLICY_URL).toBe("https://timeway.co/privacy");
    expect(c.COMPANY_NAME).toBe("AWSTREAMS DMCC");
  });
});
