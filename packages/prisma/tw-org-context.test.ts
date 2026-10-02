import { describe, expect, it, vi } from "vitest";

import { TwOrgContextError, withTwOrg, withTwPlatform } from "./tw-org-context";

function fakeClient() {
  const calls: { sql: string; values: unknown[] }[] = [];
  const tx = {
    $executeRaw: vi.fn(async (q: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: q.join("?"), values });
      return 1;
    }),
  };
  const client = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  return { client, tx, calls };
}

const ORG = "6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";

describe("TW-T9 org context", () => {
  it("sets app.tw_org_id transaction-locally before running fn, inside one $transaction", async () => {
    const { client, calls } = fakeClient();
    const out = await withTwOrg(client, ORG, async () => {
      expect(calls).toHaveLength(1);
      return "ok";
    });
    expect(out).toBe("ok");
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(calls[0].sql).toContain("set_config('app.tw_org_id', ?, true)");
    expect(calls[0].values).toEqual([ORG]);
  });

  it.each([undefined, "", "1", "org-b", `${ORG}' or '1'='1`, 42])("rejects non-UUID org id %p without touching the DB", async (bad) => {
    const { client } = fakeClient();
    await expect(withTwOrg(client, bad as string, async () => 1)).rejects.toBeInstanceOf(TwOrgContextError);
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("platform context sets the literal 'on' and requires a reason", async () => {
    const { client, calls } = fakeClient();
    await withTwPlatform(client, "provision", async () => 1);
    expect(calls[0].sql).toContain("set_config('app.tw_platform', 'on', true)");
    await expect(withTwPlatform(client, " ", async () => 1)).rejects.toBeInstanceOf(TwOrgContextError);
  });
});
