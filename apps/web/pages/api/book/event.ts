import process from "node:process";
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getRegularBookingService } from "@calcom/features/bookings/di/RegularBookingService.container";
import { BotDetectionService } from "@calcom/features/bot-detection";
import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import { FeaturesRepository } from "@calcom/features/flags/features.repository";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import getIP from "@calcom/lib/getIP";
import { checkCfTurnstileToken } from "@calcom/lib/server/checkCfTurnstileToken";
import { defaultResponder } from "@calcom/lib/server/defaultResponder";
import { piiHasher } from "@calcom/lib/server/PiiHasher";
import { publicLookupsForBookingBody, runWithPublicTwOrg } from "@calcom/lib/server/tw-org-scope/public";
import type { TraceContext } from "@calcom/lib/tracing";
import { prisma } from "@calcom/prisma";
import { CreationSource } from "@calcom/prisma/enums";
import type { NextApiRequest } from "next";

async function handler(req: NextApiRequest & { userId?: number; traceContext: TraceContext }) {
  const userIp = getIP(req);

  if (process.env.NEXT_PUBLIC_CLOUDFLARE_USE_TURNSTILE_IN_BOOKER === "1") {
    await checkCfTurnstileToken({
      token: req.body["cfToken"] as string,
      remoteIp: userIp,
    });
  }

  // Check for bot detection using feature flag
  const featuresRepository = new FeaturesRepository(prisma);
  const eventTypeRepository = new EventTypeRepository(prisma);
  const botDetectionService = new BotDetectionService(featuresRepository, eventTypeRepository);

  await botDetectionService.checkBotDetection({
    eventTypeId: req.body.eventTypeId,
    headers: req.headers,
  });

  await checkRateLimitAndThrowError({
    rateLimitingType: "core",
    identifier: `createBooking:${piiHasher.hash(userIp)}`,
  });

  const session = await getServerSession({ req });
  /* To mimic API behavior and comply with types */
  req.body = {
    ...req.body,
    // Embeds may not get the reserveSlot cookie (third-party context), so the body value wins.
    reservedSlotUid: req.body.reservedSlotUid ?? req.cookies?.uid,
    creationSource: CreationSource.WEBAPP,
  };

  const regularBookingService = getRegularBookingService();
  const booking = await regularBookingService.createBooking({
    bookingData: req.body,
    bookingMeta: {
      userId: session?.user?.id || -1,
      hostname: req.headers.host || "",
      forcedSlug: req.headers["x-cal-force-slug"] as string | undefined,
      traceContext: req.traceContext,
    },
  });

  return booking;
}

// TW-T9.2b2: the booked username(s) or team slug resolve the org; a reschedule must be in it too.
async function handlerInPublicOrg(req: NextApiRequest & { userId?: number; traceContext: TraceContext }) {
  const lookups = publicLookupsForBookingBody(req.body);
  return runWithPublicTwOrg(prisma, lookups, () => handler(req));
}

export default defaultResponder(handlerInPublicOrg, "/api/book/event");
