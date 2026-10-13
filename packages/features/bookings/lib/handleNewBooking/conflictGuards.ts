import type { ISelectedSlotRepository } from "@calcom/features/selectedSlots/repositories/ISelectedSlotRepository";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { HttpError } from "@calcom/lib/http-error";
import { safeStringify } from "@calcom/lib/safeStringify";
import type { PrismaClient } from "@calcom/prisma";
import { BookingStatus } from "@calcom/prisma/enums";
import type { PartialReference } from "@calcom/types/EventManager";
import { metrics } from "@sentry/nextjs";

type WriteResult = { type: string; success: boolean };

export const CALENDAR_WRITE_FAILED_REASON = "calendar_write_failed";

const isProviderCalendarResult = (result: WriteResult): boolean =>
  result.type.includes("_calendar") && !result.type.includes("other_calendar");

/**
 * WC-TW-3: a booking whose host calendar never received the event is an orphan the host cannot see,
 * so the booking must fail. Only provider calendars count; video/CRM failures keep their old behaviour.
 */
export function didProviderCalendarWriteFail(results: WriteResult[]): boolean {
  const calendarResults = results.filter(isProviderCalendarResult);
  return calendarResults.length > 0 && calendarResults.every((result) => !result.success);
}

/**
 * Undo everything the failed confirmation created: provider/video artefacts that did get written are
 * deleted, and the booking row is cancelled (which also clears its idempotency key, freeing the slot).
 * Always throws so the caller never continues into emails, webhooks or payments.
 */
export async function failBookingOnCalendarWriteFailure({
  prismaClient,
  bookingId,
  cleanup,
  results,
  referencesToCreate,
  logger,
}: {
  prismaClient: Pick<PrismaClient, "booking">;
  bookingId: number;
  cleanup: (references: PartialReference[]) => Promise<unknown>;
  results: WriteResult[];
  referencesToCreate: PartialReference[];
  logger: { error: (...args: unknown[]) => void };
}): Promise<never> {
  // EventManager.create maps results 1:1 into referencesToCreate, so the indexes line up.
  const written = referencesToCreate.filter((ref, i) => results[i]?.success && ref.uid);
  const failedProviders = results.filter((r) => isProviderCalendarResult(r) && !r.success).map((r) => r.type);

  try {
    if (written.length) await cleanup(written);
  } catch (error) {
    logger.error("Rollback of written calendar/video artefacts failed", safeStringify(error));
  }

  await prismaClient.booking.update({
    where: { id: bookingId },
    data: { status: BookingStatus.CANCELLED, cancellationReason: CALENDAR_WRITE_FAILED_REASON },
  });

  for (const provider of failedProviders) {
    metrics.count("booking.calendar_write.failed", 1, { attributes: { provider } });
  }
  logger.error(
    "Booking failed: provider calendar write failed",
    safeStringify({ bookingId, failedProviders })
  );

  throw new HttpError({ statusCode: 502, message: ErrorCode.CalendarWriteFailed });
}

/**
 * WC-TW-3: the 5-minute hold taken by reserveSlot during form completion is binding at confirm time.
 * The booker's own hold (same reservation uid) never blocks them.
 */
export async function assertSlotNotReservedByOthers({
  selectedSlotRepository,
  eventTypeId,
  startTime,
  endTime,
  reservedSlotUid,
}: {
  selectedSlotRepository: Pick<ISelectedSlotRepository, "findReservedByOthers">;
  eventTypeId: number;
  startTime: Date;
  endTime: Date;
  reservedSlotUid: string | null | undefined;
}): Promise<void> {
  const heldByOther = await selectedSlotRepository.findReservedByOthers({
    slot: { utcStartIso: startTime.toISOString(), utcEndIso: endTime.toISOString() },
    eventTypeId,
    // An empty uid matches no real reservation, so a booker without a hold sees every active hold.
    uid: reservedSlotUid ?? "",
  });
  if (!heldByOther) return;

  metrics.count("booking.reservation.conflict", 1);
  throw new HttpError({ statusCode: 409, message: ErrorCode.BookingConflict });
}
