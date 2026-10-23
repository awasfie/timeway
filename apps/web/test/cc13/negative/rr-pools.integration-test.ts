/**
 * CC-13 negative tests, WC-TW-7d group 4: round-robin pools with outside users.
 * A's RR event type cannot take a host who is not an accepted member of A's team.
 */
import { loadUsers } from "@calcom/features/bookings/lib/handleNewBooking/loadUsers";
import { prisma } from "@calcom/prisma";
import { SchedulingType } from "@calcom/prisma/enums";
import { updateHandler } from "@calcom/trpc/server/routers/viewer/eventTypes/heavy/update.handler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Cc13Seed } from "../seed";
import { seedCc13Tenants } from "../seed";

let seed: Cc13Seed;
let rrEventTypeId: number;

const hostIds = async () =>
  (await prisma.host.findMany({ where: { eventTypeId: rrEventTypeId }, select: { userId: true } }))
    .map((h) => h.userId)
    .sort((a, b) => a - b);

const updateCtx = () => {
  const { owner, team } = seed.A;
  return {
    user: {
      id: owner.id,
      username: owner.username,
      profile: { id: null },
      userLevelSelectedCalendars: [],
      organizationId: team.id,
      email: owner.email,
      locale: "en",
    },
    prisma,
  } as never;
};

const setHosts = (userIds: number[]) =>
  updateHandler({
    ctx: updateCtx(),
    input: { id: rrEventTypeId, hosts: userIds.map((userId) => ({ userId, isFixed: false })) } as never,
  });

beforeAll(async () => {
  seed = await seedCc13Tenants();
  const { A } = seed;
  const et = await prisma.eventType.create({
    data: {
      title: "CC-13 A round robin",
      slug: `cc13-${seed.runId}-a-rr`,
      length: 30,
      teamId: A.team.id,
      twOrgId: A.twOrg.id,
      scheduleId: A.schedule.id,
      schedulingType: SchedulingType.ROUND_ROBIN,
    },
    select: { id: true },
  });
  rrEventTypeId = et.id;
  await prisma.host.create({ data: { eventTypeId: et.id, userId: A.owner.id, isFixed: false } });
});

afterAll(async () => {
  if (rrEventTypeId) await prisma.host.deleteMany({ where: { eventTypeId: rrEventTypeId } });
  await seed?.cleanup();
});

describe("CC-13 negative: RR pools with outside users (WC-TW-7d)", () => {
  it("refuses to assign tenant B's user as a host of A's RR event type", async () => {
    const before = await hostIds();
    await expect(setHosts([seed.A.owner.id, seed.B.owner.id])).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await hostIds()).toEqual(before);
  });

  it("refuses an A-only pool that also lists B's member, and leaves A's pool as it was", async () => {
    const before = await hostIds();
    await expect(setHosts([seed.B.member.id])).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await hostIds()).toEqual(before);
  });

  it("accepts A's own accepted member (control: the refusal above is about membership)", async () => {
    await setHosts([seed.A.owner.id, seed.A.member.id]);
    expect(await hostIds()).toEqual([seed.A.owner.id, seed.A.member.id].sort((a, b) => a - b));
  });

  it("assignment never picks a non-member host row that bypassed the write path", async () => {
    // A stray Host row (restored backup, direct SQL) pointing at B's user.
    await prisma.host.create({ data: { eventTypeId: rrEventTypeId, userId: seed.B.owner.id, isFixed: false } });
    const rows = await prisma.host.findMany({
      where: { eventTypeId: rrEventTypeId },
      select: {
        isFixed: true,
        priority: true,
        weight: true,
        createdAt: true,
        groupId: true,
        user: { select: { id: true, uuid: true, email: true } },
      },
    });
    const picked = await loadUsers({
      eventType: {
        id: rrEventTypeId,
        schedulingType: SchedulingType.ROUND_ROBIN,
        hosts: rows,
        users: [],
        team: { id: seed.A.team.id, parentId: null, rrResetInterval: null, rrTimestampBasis: "CREATED_AT" },
        assignAllTeamMembers: false,
        assignRRMembersUsingSegment: false,
        rrSegmentQueryValue: null,
      } as never,
      dynamicUserList: [],
      routedTeamMemberIds: null,
      contactOwnerEmail: null,
      hostname: "localhost",
      forcedSlug: undefined,
      isPlatform: false,
    });
    expect(picked.map((u) => u.id)).not.toContain(seed.B.owner.id);
  });
});
