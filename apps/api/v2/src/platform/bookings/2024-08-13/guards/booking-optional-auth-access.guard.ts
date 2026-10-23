import { ApiAuthGuardUser } from "@/modules/auth/strategies/api-auth/api-auth.strategy";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Request } from "express";

import { BookingAccessService } from "@calcom/platform-libraries";

/**
 * CC13-API-002/003 (t_fa3a2475): access rule for booking endpoints that anonymous bookers use by uid
 * (GET /:bookingUid, POST /:bookingUid/cancel, POST /:bookingUid/reschedule).
 *
 * Decision recorded on the card:
 * - No authentication -> allowed. The uid (or seatUid) stays the booker's capability, as the booking
 *   success / cancel / reschedule pages need it.
 * - Authenticated caller -> must be the organizer, a host, a team/org admin of the booking
 *   (BookingAccessService) or one of its attendees by email. Any other authenticated caller,
 *   e.g. another tenant's OAuth token, is refused with 403.
 *
 * Must run after OptionalApiAuthGuard so request.user is set when credentials were sent.
 */
@Injectable()
export class BookingOptionalAuthAccessGuard implements CanActivate {
  private bookingAccessService: BookingAccessService;

  constructor(private readonly prismaReadService: PrismaReadService) {
    this.bookingAccessService = new BookingAccessService(this.prismaReadService.prisma);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: ApiAuthGuardUser | null }>();
    const user = request.user;
    const bookingUid = request.params.bookingUid;

    if (!bookingUid) {
      throw new BadRequestException("BookingOptionalAuthAccessGuard - bookingUid is required");
    }

    if (!user) return true;

    const prisma = this.prismaReadService.prisma;
    let booking = await prisma.booking.findUnique({
      where: { uid: bookingUid },
      select: { uid: true, attendees: { select: { email: true } } },
    });
    if (!booking) {
      // :bookingUid may be a recurringEventId; authorize against one of its recurrences.
      booking = await prisma.booking.findFirst({
        where: { recurringEventId: bookingUid },
        select: { uid: true, attendees: { select: { email: true } } },
      });
    }

    // Unknown uid: let the handler return its usual 404.
    if (!booking) return true;

    const userEmail = user.email?.toLowerCase();
    if (userEmail && booking.attendees.some((a) => a.email.toLowerCase() === userEmail)) {
      return true;
    }

    const hasAccess = await this.bookingAccessService.doesUserIdHaveAccessToBooking({
      userId: user.id,
      bookingUid: booking.uid,
    });
    if (!hasAccess) {
      throw new ForbiddenException(
        `BookingOptionalAuthAccessGuard - user with id=${user.id} does not have access to booking with uid=${bookingUid}`
      );
    }
    return true;
  }
}
