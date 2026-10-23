/**
 * CC-13 negative tests, WC-TW-7d group 1: invitations.
 * Main has no invite-creation endpoint (the team invite tRPC router is not in this tree), so
 * "B's admin cannot invite into A" is recorded as none in manifest.ts. What exists is the
 * signup-with-token path (VerificationToken.teamId), which is what these probes drive.
 */
import { randomBytes } from "node:crypto";
import handler from "app/api/auth/signup/handlers/selfHostedHandler";
import { prisma } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Cc13Seed } from "../seed";
import { seedCc13Tenants } from "../seed";

let seed: Cc13Seed;
let n = 0;
const emails: string[] = [];
const PASSWORD = "Cc13-Neg-Pass-9x!";

const mintToken = (teamId: number, identifier: string, expires = new Date(Date.now() + 86_400_000)) => {
  const token = randomBytes(16).toString("hex");
  return prisma.verificationToken
    .create({ data: { identifier, token, teamId, expires }, select: { token: true } })
    .then((r) => r.token);
};

const freshEmail = () => {
  const e = `cc13-${seed.runId}-inv${++n}@cc13.test`;
  emails.push(e);
  return e;
};

const signup = async (email: string, token: string) => {
  try {
    const res = await handler({ email, username: email.split("@")[0], password: PASSWORD, token });
    return { status: res.status };
  } catch (e) {
    return { status: (e as { statusCode?: number }).statusCode ?? 500 };
  }
};

const membershipsOf = async (email: string) =>
  prisma.membership.findMany({
    where: { user: { email } },
    select: { teamId: true, role: true, accepted: true },
  });

beforeAll(async () => {
  seed = await seedCc13Tenants();
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.verificationToken.deleteMany({
    where: { OR: [{ identifier: { in: emails } }, { teamId: { in: [seed.A.team.id, seed.B.team.id] } }] },
  });
  await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
  await prisma.profile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await seed?.cleanup();
});

describe("CC-13 negative: invitations (WC-TW-7d)", () => {
  it("an invite token minted for A's invitee creates only a MEMBER membership in A, never an elevated role", async () => {
    const email = freshEmail();
    const token = await mintToken(seed.A.team.id, email);
    expect((await signup(email, token)).status).toBe(201);
    const rows = await membershipsOf(email);
    expect(rows.map((r) => r.teamId)).toEqual([seed.A.team.id]);
    expect(rows[0]).toMatchObject({ role: MembershipRole.MEMBER, accepted: true });
  });

  it("an invite token for tenant B grants nothing in tenant A", async () => {
    const email = freshEmail();
    const token = await mintToken(seed.B.team.id, email);
    expect((await signup(email, token)).status).toBe(201);
    const rows = await membershipsOf(email);
    expect(rows.some((r) => r.teamId === seed.A.team.id)).toBe(false);
    expect(rows.map((r) => r.teamId)).toEqual([seed.B.team.id]);
  });

  it("an expired invite token is refused and creates no user", async () => {
    const email = freshEmail();
    const token = await mintToken(seed.A.team.id, email, new Date(Date.now() - 60_000));
    expect((await signup(email, token)).status).toBe(401);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it("an existing member's invite cannot raise their role (pending ADMIN stays what the inviter set)", async () => {
    const email = freshEmail();
    const token = await mintToken(seed.A.team.id, email);
    const user = await prisma.user.create({
      data: { email, username: email.split("@")[0], invitedTo: seed.A.team.id },
      select: { id: true },
    });
    await prisma.membership.create({
      data: { teamId: seed.A.team.id, userId: user.id, role: MembershipRole.MEMBER, accepted: false },
    });
    await signup(email, token);
    const rows = await membershipsOf(email);
    expect(rows.find((r) => r.teamId === seed.A.team.id)?.role).toBe(MembershipRole.MEMBER);
  });

  it.fails("DEFECT CC13-D2: an invite token minted for one email cannot be accepted by a different email", async () => {
    const invitee = freshEmail();
    const intruder = freshEmail();
    const token = await mintToken(seed.A.team.id, invitee);
    const res = await signup(intruder, token);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await membershipsOf(intruder)).some((r) => r.teamId === seed.A.team.id)).toBe(false);
  });
});
