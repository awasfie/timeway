import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PLATFORM_ACCOUNT = "acct_platform_test";
const CONNECTED_ACCOUNT = "acct_connected_test";

const stripeMock = vi.hoisted(() => ({
  accounts: { retrieve: vi.fn() },
  paymentIntents: { create: vi.fn(), cancel: vi.fn() },
  setupIntents: { create: vi.fn() },
  refunds: { create: vi.fn() },
  customers: { retrieve: vi.fn() },
  paymentMethods: { retrieve: vi.fn() },
  checkout: { sessions: { list: vi.fn(), expire: vi.fn() } },
}));

const prismaMock = vi.hoisted(() => ({
  payment: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
}));

const customerMock = vi.hoisted(() => ({ retrieveOrCreateStripeCustomerByEmail: vi.fn() }));

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return stripeMock;
  }),
}));
vi.mock("@calcom/prisma", () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock("./customer", () => customerMock);
vi.mock("@calcom/features/tasker", () => ({ default: { create: vi.fn() } }));
vi.mock("@calcom/features/bookings/repositories/BookingRepository", () => ({
  BookingRepository: class {
    findByIdIncludeUserAndAttendees = vi.fn();
  },
}));

import {
  BuildPaymentService,
  resetStripePlatformAccountCacheForTests,
  STRIPE_PLATFORM_ACCOUNT_REFUSED,
} from "./PaymentService";

function credentialFor(stripeUserId: string | undefined) {
  return {
    key: {
      ...(stripeUserId ? { stripe_user_id: stripeUserId } : {}),
      default_currency: "aed",
      stripe_publishable_key: "pk_test_x",
    },
  };
}

function createPayment(stripeUserId: string | undefined) {
  return BuildPaymentService(credentialFor(stripeUserId)).create(
    { amount: 10000, currency: "aed" },
    1,
    1,
    "host",
    "Booker",
    "ON_BOOKING",
    "booker@example.com"
  );
}

function allStripeCallOptions() {
  return [
    ...stripeMock.paymentIntents.create.mock.calls,
    ...stripeMock.setupIntents.create.mock.calls,
    ...stripeMock.refunds.create.mock.calls,
    ...stripeMock.paymentIntents.cancel.mock.calls,
    ...stripeMock.checkout.sessions.list.mock.calls,
  ].map((call) => call[1]);
}

describe("Stripe own-account guard (WC-TW-13 G3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStripePlatformAccountCacheForTests();
    stripeMock.accounts.retrieve.mockResolvedValue({ id: PLATFORM_ACCOUNT });
    customerMock.retrieveOrCreateStripeCustomerByEmail.mockResolvedValue({ id: "cus_1" });
    stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_1" });
    stripeMock.setupIntents.create.mockResolvedValue({ id: "seti_1" });
    stripeMock.refunds.create.mockResolvedValue({ id: "re_1", status: "succeeded" });
    stripeMock.checkout.sessions.list.mockResolvedValue({ data: [] });
    stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_1" });
    prismaMock.payment.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
    prismaMock.payment.update.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
  });

  it("refuses create on the platform account and never creates a PaymentIntent", async () => {
    await expect(createPayment(PLATFORM_ACCOUNT)).rejects.toThrow();
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(customerMock.retrieveOrCreateStripeCustomerByEmail).not.toHaveBeenCalled();
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it("refuses create when stripe_user_id is missing", async () => {
    await expect(createPayment(undefined)).rejects.toThrow();
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("creates on the connected account with stripeAccount and no application fee", async () => {
    const payment = await createPayment(CONNECTED_ACCOUNT);
    expect(payment.externalId).toBe("pi_1");
    expect(stripeMock.accounts.retrieve).toHaveBeenCalledWith();
    expect(customerMock.retrieveOrCreateStripeCustomerByEmail).toHaveBeenCalledWith(
      CONNECTED_ACCOUNT,
      "booker@example.com",
      undefined
    );
    const [params, options] = stripeMock.paymentIntents.create.mock.calls[0];
    expect(options).toEqual({ stripeAccount: CONNECTED_ACCOUNT });
    expect(params).not.toHaveProperty("application_fee_amount");
    expect(params).not.toHaveProperty("transfer_data");
    expect(params).not.toHaveProperty("on_behalf_of");
  });

  it("reads the platform account id once and caches it", async () => {
    await createPayment(CONNECTED_ACCOUNT);
    await createPayment(CONNECTED_ACCOUNT);
    expect(stripeMock.accounts.retrieve).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed platform lookup and fails closed", async () => {
    stripeMock.accounts.retrieve.mockRejectedValueOnce(new Error("network"));
    await expect(createPayment(CONNECTED_ACCOUNT)).rejects.toThrow();
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    await createPayment(CONNECTED_ACCOUNT);
    expect(stripeMock.accounts.retrieve).toHaveBeenCalledTimes(2);
  });

  it("refuses collectCard (HOLD) on the platform account", async () => {
    await expect(
      BuildPaymentService(credentialFor(PLATFORM_ACCOUNT)).collectCard(
        { amount: 500, currency: "aed" },
        1,
        "HOLD",
        "booker@example.com"
      )
    ).rejects.toThrow();
    expect(stripeMock.setupIntents.create).not.toHaveBeenCalled();
  });

  it("refuses refund when the payment was recorded on the platform account", async () => {
    prismaMock.payment.findFirst.mockResolvedValue({
      id: 1,
      externalId: "pi_1",
      success: true,
      refunded: false,
      data: { stripeAccount: PLATFORM_ACCOUNT },
    });
    await expect(BuildPaymentService(credentialFor(CONNECTED_ACCOUNT)).refund(1)).rejects.toMatchObject({
      message: STRIPE_PLATFORM_ACCOUNT_REFUSED,
    });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("refuses refund when the credential is the platform account", async () => {
    prismaMock.payment.findFirst.mockResolvedValue({
      id: 1,
      externalId: "pi_1",
      success: true,
      refunded: false,
      data: { stripeAccount: CONNECTED_ACCOUNT },
    });
    await expect(BuildPaymentService(credentialFor(PLATFORM_ACCOUNT)).refund(1)).rejects.toMatchObject({
      message: STRIPE_PLATFORM_ACCOUNT_REFUSED,
    });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("refunds on the connected account", async () => {
    prismaMock.payment.findFirst.mockResolvedValue({
      id: 1,
      externalId: "pi_1",
      success: true,
      refunded: false,
      data: { stripeAccount: CONNECTED_ACCOUNT },
    });
    const refunded = await BuildPaymentService(credentialFor(CONNECTED_ACCOUNT)).refund(1);
    expect(refunded?.refunded).toBe(true);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1" },
      { stripeAccount: CONNECTED_ACCOUNT }
    );
  });

  it("does not cancel a PaymentIntent on the platform account", async () => {
    prismaMock.payment.findFirst.mockResolvedValue({
      id: 1,
      externalId: "pi_1",
      data: { stripeAccount: PLATFORM_ACCOUNT },
    });
    expect(await BuildPaymentService(credentialFor(CONNECTED_ACCOUNT)).deletePayment(1)).toBe(false);
    expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
  });

  it("every Stripe call made in this suite carried the connected account", async () => {
    await createPayment(CONNECTED_ACCOUNT);
    prismaMock.payment.findFirst.mockResolvedValue({
      id: 1,
      externalId: "pi_1",
      success: true,
      refunded: false,
      data: { stripeAccount: CONNECTED_ACCOUNT },
    });
    await BuildPaymentService(credentialFor(CONNECTED_ACCOUNT)).refund(1);
    await BuildPaymentService(credentialFor(CONNECTED_ACCOUNT)).deletePayment(1);
    const options = allStripeCallOptions();
    expect(options.length).toBeGreaterThanOrEqual(4);
    for (const option of options) expect(option).toEqual({ stripeAccount: CONNECTED_ACCOUNT });
  });

  it("no application_fee_amount anywhere in the stripepayment app", () => {
    const source = readFileSync(join(__dirname, "PaymentService.ts"), "utf8");
    expect(source).not.toMatch(/application_fee/);
  });
});
