import type { Payment } from "@calcom/prisma/client";
import { describe, expect, it } from "vitest";
import { getHostedRedirectUrl, HOSTED_REDIRECT_ONLY_MESSAGE, HostedRedirectOnly } from "./types";

class FakeProvider extends HostedRedirectOnly {
  readonly slug = "tap" as const;
  async create(): Promise<Payment> {
    return { data: { redirectUrl: "https://pay.example/abc" } } as unknown as Payment;
  }
  async refund() {
    return null;
  }
  async afterPayment() {}
  async deletePayment() {
    return true;
  }
  isSetupAlready() {
    return true;
  }
}

describe("HostedRedirectOnly (WC-TW-13 G1)", () => {
  const provider = new FakeProvider();

  it("collectCard throws hosted-redirect-only", async () => {
    await expect(
      provider.collectCard({ amount: 100, currency: "AED" }, 1, "HOLD", "a@example.com")
    ).rejects.toThrow(HOSTED_REDIRECT_ONLY_MESSAGE);
  });

  it("chargeCard throws hosted-redirect-only", async () => {
    await expect(provider.chargeCard({ amount: 100, currency: "AED" }, 1)).rejects.toThrow(
      HOSTED_REDIRECT_ONLY_MESSAGE
    );
  });

  it("create exposes data.redirectUrl", async () => {
    const payment = await provider.create();
    expect(getHostedRedirectUrl(payment)).toBe("https://pay.example/abc");
  });

  it("getHostedRedirectUrl returns null for missing or invalid data", () => {
    expect(getHostedRedirectUrl({ data: null } as unknown as Payment)).toBeNull();
    expect(getHostedRedirectUrl({ data: [] } as unknown as Payment)).toBeNull();
    expect(getHostedRedirectUrl({ data: { redirectUrl: "" } } as unknown as Payment)).toBeNull();
  });
});
