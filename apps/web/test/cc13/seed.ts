/**
 * CC-13 shared seed (WC-TW-7a). Two fully separate tenants, A and B, for the cross-tenant
 * probes in WC-TW-7b/c/d. Each tenant gets both tenancy layers so every probe can pick
 * the one its surface reads:
 *   - upstream: a Team with isOrganization=true, owner + member Memberships, User.organizationId
 *   - Timeway:  a tw_organization row, owner + member tw_organization_member rows, twOrgId stamped
 *     on users, event type, booking and schedule
 * plus a team webhook, a team API key and a tw org API key (raw keys returned for probes only).
 *
 * Integration DB only. Every row carries a per-call run tag (cc13-<runId>-) in its slug, email,
 * uid, id or note, and cleanup() deletes exactly the rows with that tag.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@calcom/prisma";
import { BookingStatus, MembershipRole, WebhookTriggerEvents } from "@calcom/prisma/enums";
import { withTwPlatform } from "@calcom/prisma/tw-org-context";

export type TenantLabel = "A" | "B";

export interface SeededTenant {
  label: TenantLabel;
  team: { id: number; slug: string };
  twOrg: { id: string; slug: string };
  owner: { id: number; email: string; username: string };
  member: { id: number; email: string; username: string };
  eventType: { id: number; slug: string };
  booking: { id: number; uid: string };
  schedule: { id: number };
  webhook: { id: string };
  apiKey: { id: string; raw: string };
  orgApiKey: { id: string; prefix: string; raw: string };
}

export interface Cc13Seed {
  runId: string;
  A: SeededTenant;
  B: SeededTenant;
  cleanup: () => Promise<void>;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function seedTenant(label: TenantLabel, runId: string): Promise<SeededTenant> {
  const tag = `cc13-${runId}-${label.toLowerCase()}`;

  const team = await prisma.team.create({
    data: { name: `CC-13 tenant ${label}`, slug: tag, isOrganization: true },
    select: { id: true, slug: true },
  });

  const twOrgId = randomUUID();
  const orgPrefix = `twk_${randomBytes(4).toString("hex")}`;
  const orgRaw = `${orgPrefix}.${randomBytes(24).toString("hex")}`;

  const mkUser = (role: "owner" | "member") =>
    prisma.user.create({
      data: {
        email: `${tag}-${role}@cc13.test`,
        username: `${tag}-${role}`,
        name: `CC-13 ${label} ${role}`,
        organizationId: team.id,
        twOrgId,
      },
      select: { id: true, email: true, username: true },
    });

  // tw_* tables are FORCE RLS: create the org inside the platform context so the seed works
  // whether the integration DB role is a superuser or not.
  const orgApiKeyId = await withTwPlatform(prisma, `CC-13 seed ${tag}`, async (tx) => {
    await tx.organization.create({ data: { id: twOrgId, slug: tag, name: `CC-13 tenant ${label}` } });
    const key = await tx.orgApiKey.create({
      data: { orgId: twOrgId, prefix: orgPrefix, hashedKey: sha256(orgRaw), scopes: ["*"] },
      select: { id: true },
    });
    return key.id;
  });

  const owner = await mkUser("owner");
  const member = await mkUser("member");

  await prisma.membership.createMany({
    data: [
      { teamId: team.id, userId: owner.id, role: MembershipRole.OWNER, accepted: true },
      { teamId: team.id, userId: member.id, role: MembershipRole.MEMBER, accepted: true },
    ],
  });
  await withTwPlatform(prisma, `CC-13 seed ${tag} members`, (tx) =>
    tx.organizationMember.createMany({
      data: [
        { orgId: twOrgId, userId: owner.id, role: "owner" },
        { orgId: twOrgId, userId: member.id, role: "member" },
      ],
    })
  );

  const schedule = await prisma.schedule.create({
    data: { name: `${tag} hours`, userId: owner.id, timeZone: "UTC", twOrgId },
    select: { id: true },
  });

  const eventType = await prisma.eventType.create({
    data: {
      title: `CC-13 ${label} meeting`,
      slug: `${tag}-meeting`,
      length: 30,
      teamId: team.id,
      twOrgId,
      scheduleId: schedule.id,
    },
    select: { id: true, slug: true },
  });

  const start = new Date(Date.UTC(2030, 0, 15, label === "A" ? 9 : 11, 0, 0));
  const booking = await prisma.booking.create({
    data: {
      uid: `${tag}-booking`,
      title: `CC-13 ${label} booking`,
      startTime: start,
      endTime: new Date(start.getTime() + 30 * 60_000),
      // Relation form, not userId: the booking idempotency extension keys on user.connect.id.
      user: { connect: { id: owner.id } },
      eventType: { connect: { id: eventType.id } },
      status: BookingStatus.ACCEPTED,
      twOrgId,
    },
    select: { id: true, uid: true },
  });

  const webhook = await prisma.webhook.create({
    data: {
      id: `${tag}-webhook`,
      teamId: team.id,
      subscriberUrl: `https://${tag}.cc13.invalid/hook`,
      eventTriggers: [WebhookTriggerEvents.BOOKING_CREATED],
      secret: randomBytes(16).toString("hex"),
    },
    select: { id: true },
  });

  const apiRaw = randomBytes(16).toString("hex");
  const apiKey = await prisma.apiKey.create({
    data: { userId: owner.id, teamId: team.id, note: tag, hashedKey: sha256(apiRaw) },
    select: { id: true },
  });

  return {
    label,
    team: { id: team.id, slug: team.slug ?? tag },
    twOrg: { id: twOrgId, slug: tag },
    owner: { id: owner.id, email: owner.email, username: owner.username ?? "" },
    member: { id: member.id, email: member.email, username: member.username ?? "" },
    eventType,
    booking,
    schedule,
    webhook,
    apiKey: { id: apiKey.id, raw: apiRaw },
    orgApiKey: { id: orgApiKeyId, prefix: orgPrefix, raw: orgRaw },
  };
}

/** Deletes every row tagged with this run, so a seed that failed half-way still cleans up. */
async function cleanupRun(runId: string): Promise<void> {
  const tag = `cc13-${runId}-`;
  const teams = await prisma.team.findMany({ where: { slug: { startsWith: tag } }, select: { id: true } });
  const users = await prisma.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } });
  const teamIds = teams.map((t) => t.id);
  const userIds = users.map((u) => u.id);
  await prisma.booking.deleteMany({ where: { uid: { startsWith: tag } } });
  await prisma.webhook.deleteMany({ where: { id: { startsWith: tag } } });
  await prisma.apiKey.deleteMany({ where: { note: { startsWith: tag } } });
  await prisma.eventType.deleteMany({ where: { slug: { startsWith: tag } } });
  await prisma.schedule.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.membership.deleteMany({ where: { teamId: { in: teamIds } } });
  // Cascades remove the tw member and tw API key rows.
  await withTwPlatform(prisma, `CC-13 cleanup ${tag}`, (tx) =>
    tx.organization.deleteMany({ where: { slug: { startsWith: tag } } })
  );
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
}

export async function seedCc13Tenants(): Promise<Cc13Seed> {
  const runId = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  try {
    const A = await seedTenant("A", runId);
    const B = await seedTenant("B", runId);
    return { runId, A, B, cleanup: () => cleanupRun(runId) };
  } catch (err) {
    await cleanupRun(runId);
    throw err;
  }
}
