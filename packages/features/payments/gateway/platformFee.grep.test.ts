import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * G6: the platform-fee percentage is a Passport metered Price from PART CM, so no Timeway code on the
 * fee path may carry a rate. This scans every file the fee line touches for a percentage or rate.
 */
const repoRoot = path.resolve(__dirname, "../../../..");
const FEE_PATH_FILES = [
  "packages/features/payments/gateway/platformFee.ts",
  "packages/features/tasker/tasks/index.ts",
  "packages/features/tasker/task-processor.ts",
  "packages/app-store/_utils/payments/handlePaymentSuccess.ts",
  "packages/features/bookings/lib/payment/handlePaymentRefund.ts",
];

function code(file: string): string {
  return readFileSync(path.join(repoRoot, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ["percent literal", /\d+(\.\d+)?\s*%/],
  ["fee/rate/percent identifier assigned a number", /\b\w*(rate|percent|percentage|bps|basisPoints)\w*\s*[:=]\s*-?\d/i],
  ["multiply by a fractional rate", /\*\s*0?\.\d+/],
  ["divide by 100 (percent maths)", /\/\s*100\b(?!_)/],
  ["application fee", /application_?fee/i],
  ["fee env var", /PLATFORM_FEE_(PERCENT|RATE|BPS)|PAYMENT_FEE_PERCENTAGE/],
];

describe("no fee percentage in Timeway platform-fee code (G6)", () => {
  it.each(FEE_PATH_FILES)("%s carries no rate", (file) => {
    const source = code(file);
    for (const [label, re] of FORBIDDEN) {
      expect(source.match(re)?.[0], `${file}: ${label}`).toBeUndefined();
    }
  });

  it("platformFee.ts reports the booking amount untouched", () => {
    const source = code("packages/features/payments/gateway/platformFee.ts");
    expect(source).toMatch(/value: kind === "charge" \? payment\.amount : -payment\.amount/);
  });

  it("the scanner flags a planted rate", () => {
    const planted = "const feeRate = 0.01; const fee = amount * 0.01; const pct = 1 %;";
    const hits = FORBIDDEN.filter(([, re]) => re.test(planted)).map(([label]) => label);
    expect(hits).toEqual(
      expect.arrayContaining(["percent literal", "fee/rate/percent identifier assigned a number", "multiply by a fractional rate"])
    );
  });
});
