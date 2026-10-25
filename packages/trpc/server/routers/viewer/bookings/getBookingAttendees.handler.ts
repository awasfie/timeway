import { BookingAccessService } from "@calcom/features/bookings/services/BookingAccessService";
import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import { TRPCError } from "@trpc/server";

import type { TGetBookingAttendeesInputSchema } from "./getBookingAttendees.schema";

type GetBookingAttendeesOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
  input: TGetBookingAttendeesInputSchema;
};

export const getBookingAttendeesHandler = async ({ ctx, input }: GetBookingAttendeesOptions) => {
  const bookingSeat = await prisma.bookingSeat.findUnique({
    where: {
      referenceUid: input.seatReferenceUid,
    },
    select: {
      bookingId: true,
      booking: {
        select: {
          _count: {
            select: {
              seatsReferences: true,
            },
          },
        },
      },
    },
  });

  if (!bookingSeat) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }

  const hasAccess = await new BookingAccessService(prisma).doesUserIdHaveAccessToBooking({
    userId: ctx.user.id,
    bookingId: bookingSeat.bookingId,
  });

  // Same answer as a missing seat, so a caller cannot probe which seat references exist.
  if (!hasAccess) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }

  return bookingSeat.booking._count.seatsReferences;
};
