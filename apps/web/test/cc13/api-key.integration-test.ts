/**
 * CC-13 apiKey probes (WC-TW-7c-3). Tenant B's upstream ApiKey and tw_org_api_key (OrgApiKey)
 * against tenant A's resources and keys.
 * Pass = B gets a refusal / empty result AND A's row is unchanged.
 */
import { createHash } from "node:crypto";
import { PrismaApiKeyRepository } from "@calcom/features/api-keys-legacy/api-keys/repositories/PrismaApiKeyRepository";
import { ApiKeyService } from "@calcom/features/api-keys-legacy/api-keys/services/ApiKeyService";
import { prisma } from "@calcom/prisma";
import { deleteHandler } from "@calcom/trpc/server/routers/viewer/apiKeys/delete.handler";
import { editHandler } from "@calcom/trpc/server/routers/viewer/apiKeys/edit.handler";
import { listHandler } from "@calcom/trpc/server/routers/viewer/apiKeys/list.handler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Cc13Seed } from "./seed";
import { seedCc13Tenants } from "./seed";

let seed: Cc13Seed;

const RLS_ROLE = "cc13_rls_probe";

/**
 * The integration DB role is a superuser, which bypasses even FORCE RLS. Org-scoped probes therefore
 * drop to a plain NOLOGIN role (SET LOCAL ROLE) inside the transaction, as the app role would run.
 * org=null runs with no org context at all (fail-closed expected).
 */
function asApp<R>(
  org: string | null,
  fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<R>
): Promise<R> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${RLS_ROLE}`);
    if (org) await tx.$executeRaw`select set_config('app.tw_org_id', ${org}, true)`;
    return fn(tx);
  });
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${RLS_ROLE}') THEN
      CREATE ROLE ${RLS_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$`);
  await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${RLS_ROLE}`);
  await prisma.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."tw_org_api_key" TO ${RLS_ROLE}`
  );
  seed = await seedCc13Tenants();
});

afterAll(async () => {
  await seed?.cleanup();
});

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
// biome-ignore lint/suspicious/noExplicitAny: handlers only read user.id from ctx
const ctxFor = (userId: number) => ({ user: { id: userId } }) as any;

const upstreamKeyRow = (id: string) =>
  prisma.apiKey.findUnique({
    where: { id },
    select: { id: true, userId: true, teamId: true, note: true, hashedKey: true, expiresAt: true },
  });

const orgKeyRow = (id: string) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.tw_platform', 'on', true)`;
    return tx.orgApiKey.findUnique({
      where: { id },
      select: { id: true, orgId: true, hashedKey: true, scopes: true, revokedAt: true },
    });
  });

describe("CC-13 apiKey probes: upstream ApiKey", () => {
  it("B's api key authenticates only as B and never as A's user or team", async () => {
    const { A, B } = seed;
    const svc = new ApiKeyService({ apiKeyRepo: new PrismaApiKeyRepository(prisma) });
    const res = await svc.verifyKeyByHashedKey(sha256(B.apiKey.raw));
    expect(res.valid).toBe(true);
    if (!res.valid) return;
    expect(res.userId).toBe(B.owner.id);
    expect(res.userId).not.toBe(A.owner.id);
    expect(res.user.email).toBe(B.owner.email);

    const row = await upstreamKeyRow(B.apiKey.id);
    expect(row?.teamId).toBe(B.team.id);
    expect(row?.teamId).not.toBe(A.team.id);
  });

  it("A's raw key is not accepted when derived from B's key material", async () => {
    const { A, B } = seed;
    const svc = new ApiKeyService({ apiKeyRepo: new PrismaApiKeyRepository(prisma) });
    for (const guess of [B.apiKey.raw.toUpperCase(), `${B.apiKey.raw}x`, A.apiKey.id, B.orgApiKey.raw]) {
      const res = await svc.verifyKeyByHashedKey(sha256(guess));
      expect(res.valid).toBe(false);
    }
  });

  it("B cannot list A's api keys", async () => {
    const { A, B } = seed;
    const rows = await listHandler({ ctx: { user: { id: B.owner.id }, prisma } as never });
    const ids = rows.map((r: { id: string }) => r.id);
    expect(ids).toContain(B.apiKey.id);
    expect(ids).not.toContain(A.apiKey.id);

    const memberRows = await listHandler({ ctx: { user: { id: B.member.id }, prisma } as never });
    expect(memberRows.map((r: { id: string }) => r.id)).not.toContain(A.apiKey.id);
  });

  it("B cannot rotate or edit A's api key", async () => {
    const { A } = seed;
    const { B } = seed;
    const before = await upstreamKeyRow(A.apiKey.id);
    await expect(
      editHandler({
        ctx: ctxFor(B.owner.id),
        input: { id: A.apiKey.id, note: "cc13 hijack", expiresAt: new Date(Date.UTC(2031, 0, 1)) },
      })
    ).rejects.toThrow();
    expect(await upstreamKeyRow(A.apiKey.id)).toEqual(before);
  });

  it("B cannot delete A's api key", async () => {
    const { A, B } = seed;
    const before = await upstreamKeyRow(A.apiKey.id);
    await expect(deleteHandler({ ctx: ctxFor(B.owner.id), input: { id: A.apiKey.id } })).rejects.toThrow();
    expect(await upstreamKeyRow(A.apiKey.id)).toEqual(before);
    expect(await upstreamKeyRow(B.apiKey.id)).not.toBeNull();
  });
});

describe("CC-13 apiKey probes: OrgApiKey (tw_org_api_key)", () => {
  it("B's org context cannot read A's org api key", async () => {
    const { A, B } = seed;
    const before = await orgKeyRow(A.orgApiKey.id);
    expect(before?.orgId).toBe(A.twOrg.id);

    const rows = await asApp(B.twOrg.id, (tx) =>
      tx.orgApiKey.findMany({ select: { id: true, orgId: true } })
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(B.orgApiKey.id);
    expect(ids).not.toContain(A.orgApiKey.id);
    for (const r of rows) expect(r.orgId).toBe(B.twOrg.id);

    const direct = await asApp(B.twOrg.id, (tx) =>
      tx.orgApiKey.findUnique({ where: { id: A.orgApiKey.id }, select: { id: true } })
    );
    expect(direct).toBeNull();
    expect(await orgKeyRow(A.orgApiKey.id)).toEqual(before);
  });

  it("B's org context cannot rotate or revoke A's org api key", async () => {
    const { A, B } = seed;
    const before = await orgKeyRow(A.orgApiKey.id);
    const updated = await asApp(B.twOrg.id, (tx) =>
      tx.orgApiKey.updateMany({
        where: { id: A.orgApiKey.id },
        data: { revokedAt: new Date(), hashedKey: sha256("cc13-hijack") },
      })
    );
    expect(updated.count).toBe(0);
    expect(await orgKeyRow(A.orgApiKey.id)).toEqual(before);
  });

  it("B's org context cannot delete A's org api key", async () => {
    const { A, B } = seed;
    const before = await orgKeyRow(A.orgApiKey.id);
    const deleted = await asApp(B.twOrg.id, (tx) =>
      tx.orgApiKey.deleteMany({ where: { id: A.orgApiKey.id } })
    );
    expect(deleted.count).toBe(0);
    expect(await orgKeyRow(A.orgApiKey.id)).toEqual(before);
  });

  it("B's org context cannot mint a key under A's org", async () => {
    const { A, B } = seed;
    const before = await asApp(A.twOrg.id, (tx) => tx.orgApiKey.count());
    await expect(
      asApp(B.twOrg.id, (tx) =>
        tx.orgApiKey.create({
          data: {
            orgId: A.twOrg.id,
            prefix: `twk_cc13x${Date.now()}`,
            hashedKey: sha256("x"),
            scopes: ["*"],
          },
        })
      )
    ).rejects.toThrow();
    expect(await asApp(A.twOrg.id, (tx) => tx.orgApiKey.count())).toBe(before);
  });

  it("B's org api key opens no upstream api-key path and no A data without an org context", async () => {
    const { A, B } = seed;
    const svc = new ApiKeyService({ apiKeyRepo: new PrismaApiKeyRepository(prisma) });
    const res = await svc.verifyKeyByHashedKey(sha256(B.orgApiKey.raw));
    expect(res.valid).toBe(false);
    expect(await asApp(null, (tx) => tx.orgApiKey.findMany({ select: { id: true } }))).toEqual([]);
    expect(await upstreamKeyRow(A.apiKey.id)).not.toBeNull();
  });
});
