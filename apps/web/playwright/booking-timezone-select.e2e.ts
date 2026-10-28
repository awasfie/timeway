import { expect } from "@playwright/test";
import { test } from "./lib/fixtures";

// The booker's timezone select is a next/dynamic (ssr:false) island since WC-TW-6c-9d;
// this guards that it still mounts, opens and applies a choice in LTR and RTL locales.
test.describe.configure({ mode: "parallel" });

test.afterEach(({ users }) => users.deleteAll());

for (const { locale, dir } of [
  { locale: "en", dir: "ltr" },
  { locale: "ar", dir: "rtl" },
]) {
  test.describe(`booker timezone select (${locale})`, () => {
    test.use({ locale, timezoneId: "Europe/London" });

    test("renders lazily and changes the booker timezone", async ({ page, users }) => {
      const user = await users.create({ locale });
      await page.goto(`/${user.username}/30-min`);
      await page.locator(`html[dir=${dir}]`).waitFor({ state: "attached" });

      const current = page.getByTestId("event-meta-current-timezone");
      await expect(current).toBeVisible();
      const input = current.locator('input[aria-label="Timezone Select"]');
      await expect(input).toBeAttached();

      await current.click();
      await input.fill("Tokyo");
      await page.keyboard.press("Enter");

      await expect(current).toContainText(/Tokyo/i);
    });
  });
}
