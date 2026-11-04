import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";
import { PricingCards } from "./PricingCards";

// L.3 1a: the signed-out front door is a marketing page with brand and a visible price, not a login form.
describe("L8-6-TW landing page", () => {
  const html = renderToStaticMarkup(<LandingPage appName="Timeway" />);

  it("shows the brand, a CM price and the trial CTA", () => {
    expect(html).toContain("Timeway");
    expect(html).toContain("$7");
    expect(html).toContain("Start free 14-day trial");
    expect(html).toContain('href="/pricing"');
  });

  it("is not a login page and carries the legal entity line", () => {
    expect(html).not.toMatch(/type="password"/);
    expect(html).not.toContain("Loading");
    expect(html).toContain("AWSTREAMS DMCC");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });

  it("renders all four CM.3 tiers on the pricing cards", () => {
    const cards = renderToStaticMarkup(<PricingCards />);
    for (const amount of ["$0", "$7", "$11", "$19", "$70", "$110", "$190"]) expect(cards).toContain(amount);
  });
});
