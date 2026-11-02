import { describe, expect, it, vi } from "vitest";

import type { WhatsaffConfig } from "./sender";
import { configForOrg, loadOrgSender, resolveSender, setOrgSender } from "./senderResolver";

const SHARED = "shared-phone-id";
const OWN = "tenant-phone-id";
const ORG = "3f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const VERIFIED = new Date("2026-10-30T08:00:00Z");
const cfg: WhatsaffConfig = {
  apiUrl: "https://wa.example",
  apiKey: "k-test",
  senderId: SHARED,
  payloadSecret: "s",
};

describe("resolveSender", () => {
  it("picks the tenant number when mode=own, id set and verified", () => {
    expect(
      resolveSender({ waSenderMode: "own", waSenderPhoneNumberId: OWN, waSenderVerifiedAt: VERIFIED }, SHARED)
    ).toEqual({
      senderId: OWN,
      source: "tenant",
    });
  });

  it("falls back to shared in every other state", () => {
    const shared = { senderId: SHARED, source: "shared" };
    expect(resolveSender(null, SHARED)).toEqual(shared);
    expect(resolveSender(undefined, SHARED)).toEqual(shared);
    expect(
      resolveSender({ waSenderMode: null, waSenderPhoneNumberId: OWN, waSenderVerifiedAt: VERIFIED }, SHARED)
    ).toEqual(shared);
    expect(
      resolveSender(
        { waSenderMode: "shared", waSenderPhoneNumberId: OWN, waSenderVerifiedAt: VERIFIED },
        SHARED
      )
    ).toEqual(shared);
    expect(
      resolveSender(
        { waSenderMode: "own", waSenderPhoneNumberId: null, waSenderVerifiedAt: VERIFIED },
        SHARED
      )
    ).toEqual(shared);
    expect(
      resolveSender(
        { waSenderMode: "own", waSenderPhoneNumberId: "  ", waSenderVerifiedAt: VERIFIED },
        SHARED
      )
    ).toEqual(shared);
    expect(
      resolveSender({ waSenderMode: "own", waSenderPhoneNumberId: OWN, waSenderVerifiedAt: null }, SHARED)
    ).toEqual(shared);
  });

  it("configForOrg swaps only the sender", () => {
    expect(configForOrg(cfg, null)).toBe(cfg);
    expect(
      configForOrg(cfg, { waSenderMode: "own", waSenderPhoneNumberId: OWN, waSenderVerifiedAt: VERIFIED })
    ).toEqual({
      ...cfg,
      senderId: OWN,
    });
  });
});

function fakeClient(rows: unknown[] | Error) {
  const exec = vi.fn(async (..._a: unknown[]) => 1);
  const query = vi.fn(async (..._a: unknown[]) => {
    if (rows instanceof Error) throw rows;
    return rows;
  });
  const tx = { $executeRaw: exec, $queryRaw: query };
  const client = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  return { client: client as unknown as Parameters<typeof loadOrgSender>[0], exec, query };
}

describe("loadOrgSender", () => {
  it("returns null without an org and on lookup errors (shared fallback)", async () => {
    expect(await loadOrgSender(fakeClient([]).client, null)).toBeNull();
    expect(await loadOrgSender(fakeClient(new Error("db down")).client, ORG)).toBeNull();
    expect(await loadOrgSender(fakeClient([]).client, "not-a-uuid")).toBeNull();
  });

  it("reads the org row inside the org RLS context", async () => {
    const row = { waSenderMode: "own", waSenderPhoneNumberId: OWN, waSenderVerifiedAt: VERIFIED };
    const f = fakeClient([row]);
    expect(await loadOrgSender(f.client, ORG)).toEqual(row);
    expect(String(f.exec.mock.calls[0][0])).toContain("app.tw_org_id");
    expect(f.exec.mock.calls[0][1]).toBe(ORG);
  });
});

describe("setOrgSender", () => {
  const listing = (data: unknown[], ok = true) =>
    vi.fn(async (_u: string, _i: RequestInit) => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => ({ data }),
    }));

  it("stores own only when Whatsaff lists the number for our account", async () => {
    const f = fakeClient([]);
    const fetchImpl = listing([{ id: OWN, display_phone_number: "+966 59 000 0000" }]);
    expect(
      await setOrgSender(f.client, ORG, { mode: "own", phoneNumberId: OWN }, cfg, VERIFIED, fetchImpl)
    ).toEqual({ ok: true, mode: "own" });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://wa.example/api/whatsapp/phone-numbers");
    expect((fetchImpl.mock.calls[0][1].headers as Record<string, string>)["x-api-key"]).toBe("k-test");
    const update = f.exec.mock.calls.find((c) => String(c[0]).includes("UPDATE"));
    expect(update?.slice(1)).toEqual([OWN, "+966 59 000 0000", VERIFIED, ORG]);
  });

  it("rejects an unlisted number and writes nothing", async () => {
    const f = fakeClient([]);
    expect(
      await setOrgSender(
        f.client,
        ORG,
        { mode: "own", phoneNumberId: "other" },
        cfg,
        VERIFIED,
        listing([{ id: OWN }])
      )
    ).toEqual({
      ok: false,
      reason: "number_not_found",
    });
    expect(f.exec).not.toHaveBeenCalled();
  });

  it("propagates a Whatsaff listing error without writing", async () => {
    const f = fakeClient([]);
    await expect(
      setOrgSender(f.client, ORG, { mode: "own", phoneNumberId: OWN }, cfg, VERIFIED, listing([], false))
    ).rejects.toThrow("500");
    expect(f.exec).not.toHaveBeenCalled();
  });

  it("switches back to shared without calling Whatsaff", async () => {
    const f = fakeClient([]);
    const fetchImpl = listing([]);
    expect(await setOrgSender(f.client, ORG, { mode: "shared" }, cfg, VERIFIED, fetchImpl)).toEqual({
      ok: true,
      mode: "shared",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(String(f.exec.mock.calls[1][0])).toContain("'shared'");
  });
});
