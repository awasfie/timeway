import process from "node:process";
import { prisma } from "@calcom/prisma";
import { withTwPlatform } from "@calcom/prisma/tw-org-context";
import { expect } from "@playwright/test";
import { test } from "./lib/fixtures";

// WC-TW-12d. Needs TW_CUSTOM_DOMAINS_ENABLED=true on the test server.
// The user is made owner of a TW-T9 Organization (tw_organization_member) so the page and nav tab render;
// customDomain tRPC is mocked at the network layer, so no TwCustomHostname rows are written.
type Row = { hostname: string; status: string; lastError: string | null } | null;

test.describe("Org settings > Custom domain", () => {
  test.skip(process.env.TW_CUSTOM_DOMAINS_ENABLED !== "true", "needs TW_CUSTOM_DOMAINS_ENABLED=true");

  const orgIds: string[] = [];
  test.afterEach(async () => {
    const ids = orgIds.splice(0);
    if (ids.length)
      await withTwPlatform(prisma, "wc-tw-12d e2e cleanup", (tx) =>
        tx.organization.deleteMany({ where: { id: { in: ids } } })
      );
  });

  for (const locale of ["en", "ar"] as const) {
    test(`add -> pending -> active -> remove (${locale})`, async ({ page, users }, testInfo) => {
      const user = await users.create({ locale } as never);
      const org = await withTwPlatform(prisma, "wc-tw-12d e2e seed", (tx) =>
        tx.organization.create({
          data: {
            slug: `e2e-cd-${locale}-${Date.now()}`,
            name: "E2E Custom Domain Org",
            members: { create: { userId: user.id, role: "owner" } },
          },
          select: { id: true },
        })
      );
      orgIds.push(org.id);
      await user.apiLogin();

      let row: Row = null;
      let refreshes = 0;
      const out = (body: unknown) => ({ result: { data: { json: body } } });
      await page.route("**/api/trpc/organizations/customDomain.*", async (route) => {
        const url = route.request().url();
        const res = (b: unknown) => route.fulfill({ json: [out(b)] });
        if (url.includes("customDomain.get"))
          return res({ hostname: row, cnameTarget: "customers.timeway.co" });
        if (url.includes("customDomain.add")) {
          const input = route.request().postDataJSON()?.["0"]?.json;
          row = { hostname: input.hostname, status: "pending_dns", lastError: null };
          return res({ hostname: row, cnameTarget: "customers.timeway.co" });
        }
        if (url.includes("customDomain.refresh")) {
          refreshes += 1;
          if (refreshes >= 2 && row) row = { ...row, status: "active" };
          return res({ hostname: row, cnameTarget: "customers.timeway.co" });
        }
        row = null;
        return res({ removed: true });
      });

      await page.goto("/settings/organizations/custom-domain");
      await expect(page.locator(`a[href="/settings/organizations/custom-domain"]`).first()).toBeVisible();
      await page.getByTestId("custom-domain-input").fill("book.example.com");
      await page.getByTestId("custom-domain-add").click();
      await expect(page.getByTestId("custom-domain-cname")).toHaveText(
        "book.example.com CNAME customers.timeway.co"
      );
      await page.screenshot({ path: testInfo.outputPath(`custom-domain-pending-${locale}.png`) });

      await expect(page.getByTestId("custom-domain-status")).toContainText(/active|نشط/i, {
        timeout: 90_000,
      });
      await page.screenshot({ path: testInfo.outputPath(`custom-domain-active-${locale}.png`) });

      await page.getByTestId("custom-domain-remove").click();
      await expect(page.getByTestId("custom-domain-input")).toBeVisible();
    });
  }
});
