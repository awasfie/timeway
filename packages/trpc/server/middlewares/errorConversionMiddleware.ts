import { TRPCError } from "@trpc/server";

import { convertErrorWithCodeToTRPCError } from "../lib/toTRPCError";
import { middleware } from "../trpc";

/**
 * Middleware that catches errors thrown by other layers and converts them to TRPCError.
 */
export const errorConversionMiddleware = middleware(async ({ next }) => {
  try {
    const result = await next();
    // tRPC v11 hands downstream failures back as { ok: false } instead of throwing, with the original
    // error as the cause; without this an ErrorWithCode (e.g. Forbidden) reached clients as a 500.
    if (!result.ok) {
      const converted = convertErrorWithCodeToTRPCError(result.error.cause);
      if (converted instanceof TRPCError) throw converted;
    }
    return result;
  } catch (e) {
    throw convertErrorWithCodeToTRPCError(e);
  }
});
