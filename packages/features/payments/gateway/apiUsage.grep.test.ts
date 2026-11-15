import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WC-TW-14c E6/E9: price, free-tier and rate numbers live only in PART CM / Passport / Stripe.
 * Scans every file the API-usage lines touch.
 */
const repoRoot = path.resolve(__dirname, "../../../..");
const FILES = [
  "packages/features/payments/gateway/apiUsage.ts",
  "apps/web/app/api/cron/api-usage-snapshot/route.ts",
];

function code(file: string): string {
  return readFileSync(path.join(repoRoot, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ["percent literal", /\d+(\.\d+)?\s*%/],
  [
    "price/free/tier/rate identifier assigned a number",
    /\b\w*(price|free|tier|rate|percent|quota|allowance|included|cents)\w*\s*[:=]\s*-?\d/i,
  ],
  ["currency amount", /[$€£]\s*\d|\b\d+\s*(usd|aed|eur|cents)\b/i],
  ["threshold compare on managed count", /(managed\w*|value|count)\s*(>|>=|<|<=)\s*\d{2,}/i],
  ["fractional multiply", /\*\s*0?\.\d+/],
];

describe("no price or free-tier number in Timeway API-usage code", () => {
  it.each(FILES)("%s carries none", (file) => {
    const source = code(file);
    for (const [label, re] of FORBIDDEN) {
      expect(source.match(re)?.[0], `${file}: ${label}`).toBeUndefined();
    }
  });

  it("the scanner flags planted numbers", () => {
    const planted = "const freeTier = 25; const price = 200; const x = value > 25; const y = '$2';";
    const hits = FORBIDDEN.filter(([, re]) => re.test(planted)).map(([l]) => l);
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });
});
