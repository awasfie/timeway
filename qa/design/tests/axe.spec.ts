import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { LOCALES, SURFACES } from "./surfaces";

// CC-55 item 19 / UX.13.4: WCAG 2.2 AA; the gate is zero serious or critical violations.
const BLOCKING = new Set(["serious", "critical"]);

for (const surface of SURFACES) {
  for (const locale of LOCALES) {
    test(`axe ${surface.id} ${locale}`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ locale, extraHTTPHeaders: { "Accept-Language": locale } });
      const page = await context.newPage();
      await page.goto(surface.url, { waitUntil: "networkidle" });
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      await testInfo.attach(`axe-${surface.id}-${locale}.json`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: "application/json",
      });
      const blocking = results.violations
        .filter((v) => BLOCKING.has(v.impact ?? ""))
        .map((v) => `${v.impact} ${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      expect(blocking, `serious/critical axe violations on ${surface.url} [${locale}]`).toEqual([]);
      await context.close();
    });
  }
}
