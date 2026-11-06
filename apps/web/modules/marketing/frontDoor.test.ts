import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { build, parseLaunch, parsePriceMap } from "../../../../scripts/front-door/gen.mjs";
import { LAUNCH, PRICE_MAP_SHA256 } from "./front-door.generated";
import { frontLocaleFromPath } from "./frontPaths";
import { frontPath, toFrontLocale } from "./i18n";

const root = join(__dirname, "../../../..");
const yamlText = readFileSync(join(root, "docs/launch/timeway.yaml"), "utf8");

// Rows in price-map.md's exact table shape (passport docs/billing/price-map.md, "## Prices").
const row = (k: string, amt: number, iv: string, trial = "—") =>
  `| \`${k}\` | \`price_x${k}\` | \`${amt}\` | \`${iv}\` | \`licensed\` | ${trial} | \`inclusive\` | True |`;
const pm = (pro = row("timeway_pro_monthly", 700, "month", "14")) =>
  [
    "## Prices (lookup_key is the canonical ID Passport's Plan table uses)",
    "| lookup_key | price_id | amount | interval | type | trial | tax | active |",
    "|---|---|---|---|---|---|---|---|",
    pro,
    row("timeway_pro_yearly", 7000, "year"),
    row("timeway_teams_monthly", 1100, "month"),
    row("timeway_teams_yearly", 11000, "year"),
    row("timeway_business_monthly", 1900, "month"),
    row("timeway_business_yearly", 19000, "year"),
    "",
    "## Meters",
  ].join("\n");

describe("FRONT-DOOR-timeway generator", () => {
  it("parses price-map rows (amount in minor units, trial, tax)", () => {
    expect((parsePriceMap(pm()) as Record<string, unknown>).timeway_pro_monthly).toMatchObject({
      amountMinor: 700,
      interval: "month",
      trialDays: 14,
      tax: "inclusive",
    });
  });

  it("refuses a Timeway price that is not tax inclusive", () => {
    const bad = row("timeway_pro_monthly", 700, "month", "14").replace("inclusive", "exclusive");
    expect(() => build(pm(bad), yamlText)).toThrow(/not tax inclusive/);
  });

  it("refuses a launch file that carries a price", () => {
    expect(() => parseLaunch(`${yamlText}\nprice: 7\n`)).toThrow(/must not carry prices/);
  });

  it("the committed generated copy matches docs/launch/timeway.yaml", () => {
    expect(PRICE_MAP_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(LAUNCH).toEqual(parseLaunch(yamlText));
  });
});

describe("FRONT-DOOR-timeway locale routing", () => {
  it.each([
    ["/ar", "ar"],
    ["/ar/pricing", "ar"],
    ["/pricing", null],
    ["/", null],
    ["/ar/alice", null],
  ])("%s -> %s", (p, l) => expect(frontLocaleFromPath(p)).toBe(l));

  it("maps paths and visitor locales", () => {
    expect(frontPath("ar", "/")).toBe("/ar");
    expect(frontPath("ar", "/pricing")).toBe("/ar/pricing");
    expect(frontPath("en", "/pricing")).toBe("/pricing");
    expect(toFrontLocale("ar-AE")).toBe("ar");
    expect(toFrontLocale(undefined)).toBe("en");
  });
});
