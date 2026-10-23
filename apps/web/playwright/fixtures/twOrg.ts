/**
 * TW-T9.2b2-e2e — Timeway org (tw_organization) for e2e users.
 *
 * Public booking paths resolve the org from the username / team slug / booking uid and
 * treat a NULL-only twOrgId as not found (packages/lib/server/tw-org-scope/public.ts).
 * Every user the fixtures create therefore joins one org per Playwright worker, and the
 * rows the public paths read (users, EventType, Schedule, Credential, Booking) carry it.
 *
 * tw_organization* tables are FORCE RLS: written in platform context, reason "e2e fixture".
 */
import { prisma } from "@calcom/prisma";
import { withTwPlatform } from "@calcom/prisma/tw-org-context";

export const E2E_TW_ORG_REASON = "e2e fixture";

const orgByWorker = new Map<number, Promise<string>>();

/** The worker's org id, created on first use (idempotent across reruns on the same DB). */
export function getE2eTwOrgId(workerIndex: number): Promise<string> {
  let org = orgByWorker.get(workerIndex);
  if (!org) {
    const slug = `e2e-worker-${workerIndex}`;
    org = withTwPlatform(prisma, E2E_TW_ORG_REASON, async (tx) => {
      const row = await tx.organization.upsert({
        where: { slug },
        update: {},
        create: { slug, name: `E2E worker ${workerIndex}` },
        select: { id: true },
      });
      return row.id;
    });
    orgByWorker.set(workerIndex, org);
    // A failed attempt must not poison the worker for later tests.
    org.catch(() => orgByWorker.delete(workerIndex));
  }
  return org;
}

/**
 * Members of `orgId`: the membership row, users.twOrgId, and the users' event types
 * (owned or hosted), schedules and credentials that are still NULL.
 */
export async function assignUsersToTwOrg(orgId: string, userIds: number[]): Promise<void> {
  const ids = Array.from(new Set(userIds));
  if (ids.length === 0) return;
  await withTwPlatform(prisma, E2E_TW_ORG_REASON, async (tx) => {
    await tx.organizationMember.createMany({
      data: ids.map((userId) => ({ orgId, userId })),
      skipDuplicates: true,
    });
    await tx.user.updateMany({ where: { id: { in: ids } }, data: { twOrgId: orgId } });
    await tx.eventType.updateMany({
      where: {
        twOrgId: null,
        OR: [{ userId: { in: ids } }, { users: { some: { id: { in: ids } } } }],
      },
      data: { twOrgId: orgId },
    });
    await tx.schedule.updateMany({ where: { twOrgId: null, userId: { in: ids } }, data: { twOrgId: orgId } });
    await tx.credential.updateMany({ where: { twOrgId: null, userId: { in: ids } }, data: { twOrgId: orgId } });
  });
}

/** Org for a booking the fixtures insert directly: its event type's, else its user's. */
export async function twOrgIdForBooking(userId: number, eventTypeId?: number | null): Promise<string | null> {
  if (eventTypeId && eventTypeId > 0) {
    const eventType = await prisma.eventType.findUnique({
      where: { id: eventTypeId },
      select: { twOrgId: true },
    });
    if (eventType?.twOrgId) return eventType.twOrgId;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { twOrgId: true } });
  return user?.twOrgId ?? null;
}
