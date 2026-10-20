import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { Booking, Payment, PaymentOption, Prisma } from "@calcom/prisma/client";
import type { EventTypeMetadata } from "@calcom/prisma/zod-utils";
import type { CalendarEvent } from "@calcom/types/Calendar";
import type { IAbstractPaymentService } from "@calcom/types/PaymentService";

/** App slugs as stored in Payment.appId / App.slug. */
export const GATEWAY_PROVIDER_SLUGS = ["tap", "paytabs", "paymob", "stripe"] as const;
export type GatewayProviderSlug = (typeof GATEWAY_PROVIDER_SLUGS)[number];

export const HOSTED_REDIRECT_ONLY_MESSAGE = "not supported: hosted redirect only";

/**
 * Payment.data shape written by hosted-redirect providers. The booker is sent to
 * redirectUrl (the provider-hosted page); the webhook, not the return URL, marks the payment paid.
 */
export type HostedRedirectPaymentData = {
  redirectUrl: string;
} & Record<string, unknown>;

/**
 * Gateway contract: the cal.com payment service narrowed to hosted redirects.
 * create() returns a Payment whose data.redirectUrl points at the provider-hosted page.
 */
export interface PaymentGatewayProvider extends IAbstractPaymentService {
  readonly slug: GatewayProviderSlug;
}

export function getHostedRedirectUrl(payment: Pick<Payment, "data">): string | null {
  const data = payment.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const redirectUrl = (data as Record<string, unknown>).redirectUrl;
  return typeof redirectUrl === "string" && redirectUrl.length > 0 ? redirectUrl : null;
}

/**
 * Base for Tap / PayTabs / Paymob. They only support paying on a provider-hosted page,
 * so card-on-file flows (HOLD / no-show fees) are refused instead of silently half-working.
 */
export abstract class HostedRedirectOnly implements PaymentGatewayProvider {
  abstract readonly slug: GatewayProviderSlug;

  abstract create(
    payment: Pick<Prisma.PaymentUncheckedCreateInput, "amount" | "currency">,
    bookingId: Booking["id"],
    userId: Booking["userId"],
    username: string | null,
    bookerName: string | null,
    paymentOption: PaymentOption,
    bookerEmail: string,
    bookerPhoneNumber?: string | null,
    eventTitle?: string,
    bookingTitle?: string
  ): Promise<Payment>;

  abstract refund(paymentId: Payment["id"]): Promise<Payment | null>;

  abstract afterPayment(
    event: CalendarEvent,
    booking: {
      user: { email: string | null; name: string | null; timeZone: string } | null;
      id: number;
      startTime: { toISOString: () => string };
      uid: string;
    },
    paymentData: Payment,
    eventTypeMetadata?: EventTypeMetadata
  ): Promise<void>;

  abstract deletePayment(paymentId: Payment["id"]): Promise<boolean>;

  abstract isSetupAlready(): boolean;

  async collectCard(
    _payment: Pick<Prisma.PaymentUncheckedCreateInput, "amount" | "currency">,
    _bookingId: Booking["id"],
    _paymentOption: PaymentOption,
    _bookerEmail: string,
    _bookerPhoneNumber?: string | null
  ): Promise<Payment> {
    throw new ErrorWithCode(ErrorCode.CollectCardFailure, HOSTED_REDIRECT_ONLY_MESSAGE, {
      provider: this.slug,
    });
  }

  async chargeCard(
    _payment: Pick<Prisma.PaymentUncheckedCreateInput, "amount" | "currency">,
    _bookingId?: Booking["id"]
  ): Promise<Payment> {
    throw new ErrorWithCode(ErrorCode.ChargeCardFailure, HOSTED_REDIRECT_ONLY_MESSAGE, {
      provider: this.slug,
    });
  }

  async update(
    _paymentId: Payment["id"],
    _data: Partial<Prisma.PaymentUncheckedCreateInput>
  ): Promise<Payment> {
    throw new Error(`${this.slug}: update is not implemented`);
  }

  async getPaymentPaidStatus(): Promise<string> {
    throw new Error(`${this.slug}: getPaymentPaidStatus is not implemented`);
  }

  async getPaymentDetails(): Promise<Payment> {
    throw new Error(`${this.slug}: getPaymentDetails is not implemented`);
  }
}
