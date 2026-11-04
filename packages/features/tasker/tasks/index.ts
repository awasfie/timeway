import { IS_PRODUCTION } from "@calcom/lib/constants";
import type { TaskHandler, TaskTypes } from "../tasker";

/**
 * This is a map of all the tasks that the Tasker can handle.
 * The keys are the TaskTypes and the values are the task handlers.
 * The task handlers are imported dynamically to avoid circular dependencies.
 */
const tasks: Record<TaskTypes, () => Promise<TaskHandler>> = {
  sendWebhook: () => import("./sendWebook").then((module) => module.sendWebhook),
  triggerHostNoShowWebhook: () =>
    import("./triggerNoShow/triggerHostNoShow").then((module) => module.triggerHostNoShow),
  triggerGuestNoShowWebhook: () =>
    import("./triggerNoShow/triggerGuestNoShow").then((module) => module.triggerGuestNoShow),
  sendSms: () => Promise.resolve(() => Promise.reject(new Error("Not implemented"))),
  translateEventTypeData: () =>
    import("./translateEventTypeData").then((module) => module.translateEventTypeData),
  createCRMEvent: () => import("./crm/createCRMEvent").then((module) => module.createCRMEvent),
  sendAnalyticsEvent: () =>
    import("./analytics/sendAnalyticsEvent").then((module) => module.sendAnalyticsEvent),
  sendAwaitingPaymentEmail: () =>
    import("./sendAwaitingPaymentEmail").then((module) => module.sendAwaitingPaymentEmail),
  bookingAudit: () => import("./bookingAudit").then((module) => module.bookingAudit),
  webhookDelivery: () => import("./webhookDelivery").then((module) => module.webhookDelivery),
  timewayApiUsage: () =>
    import("@calcom/features/payments/gateway/apiUsage").then(
      (module) => (payload: string) => module.sendApiUsage(payload)
    ),
  platformFeeUsage: () =>
    import("@calcom/features/payments/gateway/platformFee").then(
      (module) => (payload: string) => module.sendPlatformFeeUsage(payload)
    ),
};

export const tasksConfig = {
  createCRMEvent: {
    minRetryIntervalMins: IS_PRODUCTION ? 10 : 1,
    maxAttempts: 10,
  },
  webhookDelivery: {
    minRetryIntervalMins: IS_PRODUCTION ? 5 : 1,
    maxAttempts: 3,
  },
  // Exponential: 2, 4, 8 ... min, capped at 6 h, so 12 tries stay inside Passport's 35-day window.
  timewayApiUsage: {
    minRetryIntervalMins: IS_PRODUCTION ? 2 : 1,
    retryIntervalMins: (attempts: number) => Math.min(2 ** Math.max(1, attempts), 360),
    maxAttempts: 12,
  },
  platformFeeUsage: {
    minRetryIntervalMins: IS_PRODUCTION ? 2 : 1,
    retryIntervalMins: (attempts: number) => Math.min(2 ** Math.max(1, attempts), 360),
    maxAttempts: 12,
  },
};
export default tasks;
