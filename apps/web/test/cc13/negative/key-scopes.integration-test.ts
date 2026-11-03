/**
 * CC-13 negative tests, WC-TW-7d group 2: key scopes.
 * Main has no verifier for tw_org_api_key (scopes, revokedAt) — see manifest `negative.keyScopes`.
 * What exists is the legacy ApiKey path; these probes pin it: a key resolves only to its own
 * tenant's user, and an expired key is refused.
 */
import { createHash } from "node:crypto";
import { ApiKeyService } from "@calcom/features/api-keys-legacy/api-keys/services/ApiKeyService";
import { PrismaApiKeyRepository } from "@calcom/features/api-keys-legacy/api-keys/repositories/PrismaApiKeyRepository";
import { prisma } from "@calcom/prisma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Cc13Seed } from "../seed";
import { seedCc13Tenants } from "../seed";

let seed: Cc13Seed;
let service: ApiKeyService;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

beforeAll(async () => {
  seed = await seedCc13Tenants();
  service = new ApiKeyService({ apiKeyRepo: new PrismaApiKeyRepository(prisma as never) });
});
afterAll(async () => {
  await seed?.cleanup();
});

describe("CC-13 negative: key scopes (WC-TW-7d)", () => {
  it("tenant A's API key resolves to A's owner only, never to a B user", async () => {
    const r = await service.verifyKeyByHashedKey(sha256(seed.A.apiKey.raw));
    expect(r).toMatchObject({ valid: true, userId: seed.A.owner.id });
    expect(r.valid && r.userId).not.toBe(seed.B.owner.id);
  });

  it("an expired API key is rejected", async () => {
    const raw = `cc13-${seed.runId}-expired`;
    await prisma.apiKey.create({
      data: {
        userId: seed.A.owner.id,
        teamId: seed.A.team.id,
        note: `cc13-${seed.runId}-expired`,
        hashedKey: sha256(raw),
        expiresAt: new Date(Date.now() - 3 * 86_400_000),
      },
    });
    expect(await service.verifyKeyByHashedKey(sha256(raw))).toMatchObject({ valid: false });
  });

  it("an unknown key is rejected", async () => {
    expect(await service.verifyKeyByHashedKey(sha256("cc13-nope"))).toMatchObject({ valid: false });
  });
});
