import { PaymentServiceMap } from "@calcom/app-store/payment.services.generated";
import { enqueuePlatformFeeUsage } from "@calcom/features/payments/gateway/platformFee";
import type { Payment, Prisma, AppCategories } from "@calcom/prisma/client";
import type { IAbstractPaymentService } from "@calcom/types/PaymentService";

const handlePaymentRefund = async (
  paymentId: Payment["id"],
  paymentAppCredentials: {
    key: Prisma.JsonValue;
    appId: string | null;
    app: {
      dirName: string;
      categories: AppCategories[];
    } | null;
  }
) => {
  const key = paymentAppCredentials?.app?.dirName;
  const paymentAppImportFn = PaymentServiceMap[key as keyof typeof PaymentServiceMap];
  if (!paymentAppImportFn) {
    console.warn(`payment app not implemented for key: ${key}`);
    return false;
  }

  const paymentAppModule = await paymentAppImportFn;
  if (!paymentAppModule?.BuildPaymentService) {
    console.warn(`payment App service not found for key: ${key}`);
    return false;
  }
  const createPaymentService = paymentAppModule.BuildPaymentService;
  const paymentInstance = createPaymentService(paymentAppCredentials) as IAbstractPaymentService;
  const refund = await paymentInstance.refund(paymentId);
  // WC-TW-13e: negative correction; enqueue re-reads Payment.refunded and never throws.
  if (refund) await enqueuePlatformFeeUsage({ paymentId, kind: "refund" });
  return refund;
};

export { handlePaymentRefund };
