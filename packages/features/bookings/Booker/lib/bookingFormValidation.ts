import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import getBookingResponsesSchema, {
  getBookingResponsesPartialSchema,
  getBookingResponsesSchemaWithOptionalChecks,
} from "@calcom/features/bookings/lib/getBookingResponsesSchema";
import type { BookerEvent } from "@calcom/features/bookings/types";

/**
 * Everything zod-based the booker form needs. Loaded with import() from the hooks, so zod,
 * @hookform/resolvers and the form-builder schemas stay out of the booker's first-load bundle
 * (WC-TW-6n-4a). Validation behaviour is unchanged: same schema, same async zodResolver.
 */
export function getBookingFormResolver({
  bookingFields,
  view,
  translateFn,
}: {
  bookingFields: BookerEvent["bookingFields"] | undefined;
  view: "booking" | "reschedule";
  translateFn: (key: string, options?: Record<string, unknown>) => string;
}) {
  const bookingFormSchema = z
    .object({
      responses: bookingFields
        ? getBookingResponsesSchema({ bookingFields, view, translateFn })
        : // Fallback until event is loaded.
          z.object({}),
    })
    .passthrough();
  // Since this isn't set to strict we only validate the fields in the schema.
  // bookingFormSchema is an async schema, so inform RHF to do async validation.
  return zodResolver(bookingFormSchema, {}, { mode: "async" });
}

export { getBookingResponsesPartialSchema, getBookingResponsesSchemaWithOptionalChecks };
