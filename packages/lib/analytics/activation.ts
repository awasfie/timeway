import process from "node:process";
import { createServerClient } from "../../../vendor/analytics/src/server";
import { toAnalyticsLocale } from "./locale";

type CountBookings = (args: {
  where: { twOrgId: string };
  take: number;
  select: { id: true };
}) => Promise<{ id: number }[]>;

export interface FirstBookingInput {
  twOrgId: string | null;
  organizerUuid: string;
  organizerLocale: string | null | undefined;
  isDryRun: boolean;
  isReschedule: boolean;
  bookingFindMany: CountBookings;
  /** Test seam. */
  env?: { host?: string | null; key?: string | null };
  fetchImpl?: typeof fetch;
}

/**
 * WC-DX-3c-2: `activation` / first_booking_received, once per Timeway org, server-side.
 * No schema change: "first" = the org has exactly one booking row (the one just inserted).
 * `$insert_id` keyed on the org lets PostHog drop a concurrent duplicate. Never throws.
 */
export async function captureFirstBookingReceived(input: FirstBookingInput): Promise<boolean> {
  try {
    const { twOrgId, organizerUuid, isDryRun, isReschedule } = input;
    if (!twOrgId || !organizerUuid || isDryRun || isReschedule) return false;
    const client = createServerClient({
      host: input.env?.host ?? process.env.POSTHOG_INTERNAL_HOST ?? process.env.NEXT_PUBLIC_POSTHOG_HOST,
      key: input.env?.key ?? process.env.NEXT_PUBLIC_POSTHOG_KEY,
      product: "timeway",
      fetchImpl: input.fetchImpl,
    });
    if (!client.enabled) return false;
    const rows = await input.bookingFindMany({ where: { twOrgId }, take: 2, select: { id: true } });
    if (rows.length !== 1) return false;
    return await client.activation("first_booking_received", {
      distinctId: organizerUuid,
      orgId: twOrgId,
      locale: toAnalyticsLocale(input.organizerLocale),
      country: null,
      properties: { $insert_id: `activation:timeway:${twOrgId}` },
    });
  } catch {
    return false;
  }
}
