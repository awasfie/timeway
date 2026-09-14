import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";

const CAMV_APP_SLUG = "camv";
const CAMV_APP_TYPE = "livekit_video";

/**
 * TW-T7: every new Timeway user should get Camv as their default
 * conferencing location out of the box (no external account needed),
 * matching how Cal.com auto-provisions Cal Video for cal.com signups.
 * Individual users/event types can still override this afterwards via
 * the normal "Set as default" flow in Settings > Conferencing, or by
 * picking a different location on a specific event type/booking.
 *
 * Mirrors the install step in packages/app-store/livekitvideo/api/add.ts
 * and the metadata shape written by
 * packages/app-store/_utils/setDefaultConferencingApp.ts.
 */
export async function installDefaultConferencingApp(userId: number) {
  try {
    const alreadyInstalled = await prisma.credential.findFirst({
      where: { type: CAMV_APP_TYPE, userId },
      select: { id: true },
    });

    if (!alreadyInstalled) {
      await prisma.credential.create({
        data: {
          type: CAMV_APP_TYPE,
          key: {},
          userId,
          appId: CAMV_APP_SLUG,
        },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true },
    });
    const currentMetadata = (user?.metadata as Record<string, unknown> | null) ?? {};

    // Don't clobber a default the user may already have (e.g. team-invite
    // flow reusing an existing user record).
    if (!currentMetadata.defaultConferencingApp) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          metadata: {
            ...currentMetadata,
            defaultConferencingApp: { appSlug: CAMV_APP_SLUG },
          },
        },
      });
    }
  } catch (error) {
    // Never block signup on this — worst case the user falls back to
    // Cal Video / manually sets Camv as default afterwards.
    logger.error("Failed to install default Camv conferencing app for new user", { userId, error });
  }
}
