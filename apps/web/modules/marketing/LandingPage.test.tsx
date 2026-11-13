import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";
import { PricingCards } from "./PricingCards";
import { MarketingPricingPage } from "./PricingPage";

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

  it("ships a metric-matched DM Sans fallback so the font swap does not shift the page (UX.13.3 CLS)", () => {
    expect(html).toContain("<style>@font-face{font-family:DM Sans Fallback;src:local(Arial)");
    expect(html).toContain("size-adjust:105.07%");
    expect(html).toContain("font-family:&quot;DM Sans&quot;, &quot;DM Sans Fallback&quot;");
  });

  it("renders all four CM.3 tiers on the pricing cards", () => {
    const cards = renderToStaticMarkup(<PricingCards />);
    for (const amount of ["$0", "$7", "$11", "$19", "$70", "$110", "$190"]) expect(cards).toContain(amount);
  });
});

// FRONT-DOOR-timeway (t_52034498): Arabic front door at /ar and /ar/pricing, same amounts.
describe("FRONT-DOOR-timeway Arabic front door", () => {
  const home = renderToStaticMarkup(<LandingPage appName="Timeway" locale="ar" />);
  const pricing = renderToStaticMarkup(<MarketingPricingPage appName="Timeway" locale="ar" />);

  it("renders the launch hero in Arabic with AR links and an EN switch", () => {
    expect(home).toContain("صفحات حجز يُنهيها عملاؤك في دقيقة.");
    expect(home).toContain('href="/ar/pricing"');
    expect(home).toContain('href="/"');
    expect(home).toContain("English");
    expect(home).not.toContain("Loading");
  });

  it("shows the same CM.3 amounts on the Arabic pricing page", () => {
    expect(pricing).toContain("الأسعار");
    for (const amount of ["$0", "$7", "$11", "$19", "$70", "$110", "$190"]) expect(pricing).toContain(amount);
    expect(pricing).toContain("ضريبة القيمة المضافة");
  });

  it("links EN pages to their AR twin", () => {
    const en = renderToStaticMarkup(<MarketingPricingPage appName="Timeway" />);
    expect(en).toContain('href="/ar/pricing"');
    expect(en).toContain("العربية");
  });
});
