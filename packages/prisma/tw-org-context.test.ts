import { describe, expect, it, vi } from "vitest";

import { withTwOrgTransactions } from "./extensions/tw-org-context";
import {
  getTwOrgContext,
  runWithTwOrg,
  runWithTwPlatform,
  TwOrgContextError,
  withTwOrg,
  withTwPlatform,
} from "./tw-org-context";

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

describe("TW-T9.2a request scope (AsyncLocalStorage)", () => {
  it("exposes the org only inside runWithTwOrg, across awaits", async () => {
    expect(getTwOrgContext()).toBeUndefined();
    const seen = await runWithTwOrg(ORG, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return getTwOrgContext();
    });
    expect(seen).toEqual({ kind: "org", orgId: ORG });
    expect(getTwOrgContext()).toBeUndefined();
  });

  it("starts a lazy thenable inside the scope", async () => {
    let seenAtThen: unknown = "not called";
    const lazy: PromiseLike<number> = {
      then(onfulfilled) {
        seenAtThen = getTwOrgContext();
        return Promise.resolve(1).then(onfulfilled);
      },
    };
    await runWithTwOrg(ORG, () => lazy);
    expect(seenAtThen).toEqual({ kind: "org", orgId: ORG });
  });

  it("keeps concurrent scopes apart", async () => {
    const other = "0f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
    const read = (ms: number) => new Promise((r) => setTimeout(() => r(getTwOrgContext()), ms));
    const [a, b] = await Promise.all([runWithTwOrg(ORG, () => read(5)), runWithTwOrg(other, () => read(1))]);
    expect(a).toEqual({ kind: "org", orgId: ORG });
    expect(b).toEqual({ kind: "org", orgId: other });
  });

  it.each([undefined, "", "org-b", `${ORG}'--`])("rejects non-UUID org id %p", (bad) => {
    expect(() => runWithTwOrg(bad as string, () => 1)).toThrow(TwOrgContextError);
  });

  it("platform scope needs a reason", async () => {
    expect(await runWithTwPlatform("provision", () => getTwOrgContext())).toEqual({
      kind: "platform",
      reason: "provision",
    });
    expect(() => runWithTwPlatform(" ", () => 1)).toThrow(TwOrgContextError);
  });
});

describe("TW-T9.2a $transaction wrapper", () => {
  function fakePrisma() {
    const statements: string[] = [];
    const exec = (q: TemplateStringsArray, ...values: unknown[]) => {
      statements.push(`${q.join("?")} ${JSON.stringify(values)}`);
      return Promise.resolve(1);
    };
    const tx = { $executeRaw: vi.fn(exec), marker: "tx" };
    const client = {
      $executeRaw: vi.fn(exec),
      $transaction: vi.fn(async (arg: unknown) =>
        typeof arg === "function" ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as unknown[])
      ),
      other: "passthrough",
    };
    return { client, statements };
  }

  it("without a scope passes $transaction through untouched", async () => {
    const { client, statements } = fakePrisma();
    const wrapped = withTwOrgTransactions(client);
    expect(await wrapped.$transaction([Promise.resolve("a")])).toEqual(["a"]);
    await wrapped.$transaction(async () => 1);
    expect(statements).toEqual([]);
    expect(wrapped.other).toBe("passthrough");
  });

  it("interactive: sets app.tw_org_id first, on the transaction client", async () => {
    const { client, statements } = fakePrisma();
    const wrapped = withTwOrgTransactions(client);
    const marker = await runWithTwOrg(ORG, () =>
      wrapped.$transaction(async (tx: { marker: string }) => {
        expect(statements).toHaveLength(1);
        return tx.marker;
      })
    );
    expect(marker).toBe("tx");
    expect(statements[0]).toContain("set_config('app.tw_org_id', ?, true)");
    expect(statements[0]).toContain(ORG);
  });

  it("batch: prepends set_config and strips its result", async () => {
    const { client, statements } = fakePrisma();
    const wrapped = withTwOrgTransactions(client);
    const out = await runWithTwPlatform("job", () => wrapped.$transaction([Promise.resolve("a"), Promise.resolve("b")]));
    expect(out).toEqual(["a", "b"]);
    expect(statements[0]).toContain("set_config('app.tw_platform', 'on', true)");
  });
});
