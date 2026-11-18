import { describe, expect, it } from "vitest";
import { runWithTwOrg, runWithTwPlatform } from "./tw-org-context";
import { TW_ORG_KYSELY_SQL, twOrgKyselyOnReserve, twOrgKyselyParams } from "./tw-org-kysely";

const ORG = "6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";

function fakeConnection() {
  const queries: { sql: string; parameters: unknown[] }[] = [];
  return {
    queries,
    connection: {
      executeQuery: async (q: { sql: string; parameters: unknown[] }) => {
        queries.push(q);
        return { rows: [] };
      },
    },
  };
}

const raw = (sql: string, parameters: unknown[]) => ({ sql, parameters });

describe("t_1952224a Kysely org scope (onReserveConnection)", () => {
  it("org scope writes the org id and clears platform", async () => {
    expect(await runWithTwOrg(ORG, () => twOrgKyselyParams())).toEqual([ORG, ""]);
  });

  it("platform scope clears the org id and sets platform", async () => {
    expect(await runWithTwPlatform("spec", () => twOrgKyselyParams())).toEqual(["", "on"]);
  });

  it("no scope clears both, so a reused connection never keeps an earlier org", () => {
    expect(twOrgKyselyParams()).toEqual(["", ""]);
  });

  it("the hook sets both settings on the reserved connection, in the caller's scope", async () => {
    const { connection, queries } = fakeConnection();
    const hook = twOrgKyselyOnReserve(raw);
    await runWithTwOrg(ORG, () => hook(connection));
    await hook(connection);
    expect(queries).toEqual([
      { sql: TW_ORG_KYSELY_SQL, parameters: [ORG, ""] },
      { sql: TW_ORG_KYSELY_SQL, parameters: ["", ""] },
    ]);
    expect(TW_ORG_KYSELY_SQL).toContain("set_config('app.tw_org_id', $1, false)");
    expect(TW_ORG_KYSELY_SQL).toContain("set_config('app.tw_platform', $2, false)");
  });
});
