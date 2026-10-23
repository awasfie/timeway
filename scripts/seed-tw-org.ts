/**
 * TW-T9.2b2-e2e: one Timeway org (tw_organization "e2e-seed") for every seeded user.
 *
 * Public booking paths resolve the org from the username / team slug / booking uid and
 * treat NULL-only as not found (packages/lib/server/tw-org-scope/public.ts). The seed
 * users the e2e and embed suites open (free, pro, teampro, seeded teams) need a twOrgId,
 * and so do the rows those pages read. Runs last, so it covers every seed step.
 * Same derivation as scripts/tw-t9/backfill-tw-org-id.sql; dev/CI databases only.
 * tw_organization* is FORCE RLS: platform context, reason "e2e fixture".
 */
import { prisma } from "@calcom/prisma";
import { withTwPlatform } from "@calcom/prisma/tw-org-context";

const SEED_ORG_SLUG = "e2e-seed";

export default async function seedTwOrg() {
  const counts = await withTwPlatform(
    prisma,
    "e2e fixture",
    async (tx) => {
      const org = await tx.organization.upsert({
        where: { slug: SEED_ORG_SLUG },
        update: {},
        create: { slug: SEED_ORG_SLUG, name: "E2E seed" },
        select: { id: true },
      });
      const orgId = org.id;

      const members = await tx.$executeRaw`
        INSERT INTO "tw_organization_member" ("id", "orgId", "userId")
        SELECT gen_random_uuid(), ${orgId}::uuid, u.id FROM "users" u
        WHERE u."twOrgId" IS NULL
        ON CONFLICT ("orgId", "userId") DO NOTHING`;
      const users = await tx.$executeRaw`
        UPDATE "users" SET "twOrgId" = ${orgId}::uuid WHERE "twOrgId" IS NULL`;
      const schedules = await tx.$executeRaw`
        UPDATE "Schedule" s SET "twOrgId" = u."twOrgId" FROM "users" u
        WHERE u.id = s."userId" AND s."twOrgId" IS NULL`;
      const credentials = await tx.$executeRaw`
        UPDATE "Credential" c SET "twOrgId" = u."twOrgId" FROM "users" u
        WHERE u.id = c."userId" AND c."twOrgId" IS NULL`;
      const userEventTypes = await tx.$executeRaw`
        UPDATE "EventType" e SET "twOrgId" = u."twOrgId" FROM "users" u
        WHERE u.id = e."userId" AND e."twOrgId" IS NULL`;
      // Team event types: every seeded user is in the one seed org, so any team with an
      // accepted member resolves to it (same as tw_resolve_org_for_team_slug).
      const teamEventTypes = await tx.$executeRaw`
        UPDATE "EventType" e SET "twOrgId" = ${orgId}::uuid
        WHERE e."twOrgId" IS NULL AND e."teamId" IS NOT NULL
          AND EXISTS (SELECT 1 FROM "Membership" m WHERE m."teamId" = e."teamId" AND m.accepted)`;
      const bookings = await tx.$executeRaw`
        UPDATE "Booking" b SET "twOrgId" = coalesce(e."twOrgId", u."twOrgId")
        FROM "Booking" b2
        LEFT JOIN "EventType" e ON e.id = b2."eventTypeId"
        LEFT JOIN "users" u ON u.id = b2."userId"
        WHERE b2.id = b.id AND b."twOrgId" IS NULL AND coalesce(e."twOrgId", u."twOrgId") IS NOT NULL`;
      return { members, users, schedules, credentials, userEventTypes, teamEventTypes, bookings };
    },
    { timeout: 120_000 }
  );
  console.log(`🏢 tw_organization ${SEED_ORG_SLUG}:`, counts);
}
