import { expect } from "@playwright/test";
import { test } from "./lib/fixtures";

// Since WC-TW-6c-5 the booker shows a plain trigger and loads the picker chunk on intent;
// this guards that the trigger renders, the picker loads on click and applies a choice in LTR and RTL.
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
      const trigger = current.getByTestId("timezone-select-trigger");
      await expect(trigger).toBeVisible();
      const input = current.locator('input[aria-label="Timezone Select"]');
      await expect(input).toHaveCount(0);

      await trigger.click();
      await expect(input).toBeAttached();
      await input.fill("Tokyo");
      await page.keyboard.press("Enter");

      await expect(current).toContainText(/Tokyo/i);
    });
  });
}
