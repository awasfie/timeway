import { expect, test } from "@playwright/test";

import { LOCALES, SURFACES, VIEWPORTS } from "./surfaces";

// UX.13.10-5: the CI-generated render set (EN/AR x 1440/390) diffed against committed baselines.
// The booking calendar shows today's month and live slots, so it is masked; the frame around it is diffed.
const DYNAMIC = ['[data-testid="day"]', '[data-testid="time"]', '[data-testid="calendar-empty-cell"]', '[data-testid="month-picker"]', '[data-testid="incrementMonth"]', '[data-testid="decrementMonth"]', '[data-testid="selected-month-label"]'];

for (const surface of SURFACES) {
  for (const locale of LOCALES) {
    for (const vp of VIEWPORTS) {
      test(`screens ${surface.id} ${locale} ${vp.name}`, async ({ browser }) => {
        const context = await browser.newContext({
          locale,
          viewport: { width: vp.width, height: vp.height },
          extraHTTPHeaders: { "Accept-Language": locale },
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        await page.goto(surface.url, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`${surface.id}-${locale}-${vp.name}.png`, {
          fullPage: false,
          mask: DYNAMIC.map((s) => page.locator(s)),
        });
        await context.close();
      });
    }
  }
}
