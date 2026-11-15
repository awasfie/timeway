import { expect, test } from "@playwright/test";

import { LOCALES, SURFACES, VIEWPORTS } from "./surfaces";

// UX.13.10-5: the CI-generated render set (EN/AR x 1440/390) diffed against committed baselines.
// The booking calendar shows today's month and live slots, so it is masked; the frame around it is diffed.
// t_925de047: masking alone is not enough. The booker auto-selects today, and today's slot list shrinks
// through the day (past slots drop out), so masked slot buttons disappear and leave diffed background;
// the "Fri 13" header and the month grid also change daily. The booking surface therefore renders at a
// frozen browser clock: Monday 2030-01-14 09:00 Asia/Dubai, a future weekday before any seeded slot.
const BOOKING_NOW = new Date("2030-01-14T05:00:00Z");
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
        if (surface.kind === "booking") await page.clock.setFixedTime(BOOKING_NOW);
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
