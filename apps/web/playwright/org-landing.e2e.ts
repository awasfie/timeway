import { prisma } from "@calcom/prisma";
import { withTwPlatform } from "@calcom/prisma/tw-org-context";
import { expect } from "@playwright/test";
import { test } from "./lib/fixtures";

// WC-TW-12f. /team/<orgSlug> is the custom-host "/" rewrite target; it must render the org page
// (not 404), list only that org's public links, and leak no member email. Anonymous visitor, EN + AR.
test.describe("Org landing page /team/[slug]", () => {
  const orgIds: string[] = [];
  test.afterEach(async () => {
    const ids = orgIds.splice(0);
    if (!ids.length) return;
    await prisma.eventType.updateMany({ where: { twOrgId: { in: ids } }, data: { twOrgId: null } });
    await prisma.user.updateMany({ where: { twOrgId: { in: ids } }, data: { twOrgId: null } });
    await withTwPlatform(prisma, "wc-tw-12f e2e cleanup", (tx) =>
      tx.organization.deleteMany({ where: { id: { in: ids } } })
    );
  });

  test("unknown slug is 404", async ({ page }) => {
    const res = await page.goto(`/team/no-such-org-${Date.now()}?isOrgProfile=1`);
    expect(res?.status()).toBe(404);
  });

  for (const locale of ["en", "ar"] as const) {
    test(`renders org name and member links, no email (${locale})`, async ({ browser, users }, testInfo) => {
      const user = await users.create({ name: "Landing Member" });
      const slug = `e2e-landing-${locale}-${Date.now()}`;
      const org = await withTwPlatform(prisma, "wc-tw-12f e2e seed", (tx) =>
        tx.organization.create({ data: { slug, name: "E2E Landing Org" }, select: { id: true } })
      );
      orgIds.push(org.id);
      await prisma.user.update({ where: { id: user.id }, data: { twOrgId: org.id } });
      await prisma.eventType.updateMany({ where: { userId: user.id }, data: { twOrgId: org.id } });

      const context = await browser.newContext({ locale, extraHTTPHeaders: { "Accept-Language": locale } });
      const page = await context.newPage();
      const res = await page.goto(`/team/${slug}?isOrgProfile=1`);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("org-landing-name")).toHaveText("E2E Landing Org");
      const links = page.getByTestId("org-landing-link");
      await expect(links.first()).toBeVisible();
      await expect(links.first()).toHaveAttribute("href", new RegExp(`^/${user.username}/`));
      if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      expect(await page.content()).not.toContain(user.email);
      await page.screenshot({ path: testInfo.outputPath(`org-landing-${locale}.png`), fullPage: true });
      await context.close();
    });
  }
});
