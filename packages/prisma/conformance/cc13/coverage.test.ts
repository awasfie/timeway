import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { buildTenantModels, GENERATED_PATH } from "./generate.mjs";
import type { ModelCoverage, SurfaceCoverage } from "./manifest";
import { manifest, PENDING_CARDS, SURFACES } from "./manifest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

type Generated = { count: number; models: { model: string }[] };

const committed: Generated = JSON.parse(fs.readFileSync(GENERATED_PATH, "utf8"));
const tenantModels = committed.models.map((m) => m.model);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A probe id resolves when the file exists and declares a test with exactly that name.
 * it.skip / it.todo / describe.skip do not count; it.fails does (a documented leak kept red-on-fix).
 */
function probeExists(id: string): { ok: boolean; why?: string } {
  const sep = id.indexOf(" > ");
  if (sep < 0) return { ok: false, why: "probe id must be '<file> > <test name>'" };
  const file = id.slice(0, sep).trim();
  const name = id.slice(sep + 3).trim();
  if (!/\.(integration-test|e2e-spec|spec)\.ts$/.test(file)) {
    return { ok: false, why: "probe file must be *.integration-test.ts or an API v2 *.e2e-spec.ts" };
  }
  const abs = path.join(REPO_ROOT, file);
  if (!fs.existsSync(abs)) return { ok: false, why: `file not found: ${file}` };
  const src = fs.readFileSync(abs, "utf8");
  const q = `(["'\`])${escapeRe(name)}\\1`;
  const declared = new RegExp(`\\b(?:it|test)(?:\\.(?:fails|only|concurrent))?\\(\\s*${q}`).test(src);
  if (!declared) return { ok: false, why: `no active it()/test() named "${name}" in ${file}` };
  return { ok: true };
}

type Kind = "probe" | "none" | "pending";
const kindOf = (c: SurfaceCoverage): Kind =>
  typeof c === "string" ? "probe" : "none" in c ? "none" : "pending";

describe("CC-13 coverage gate (WC-TW-7a)", () => {
  it("models.generated.json matches schema.prisma (regenerate with generate.mjs)", async () => {
    const fresh = await buildTenantModels();
    expect(JSON.parse(fs.readFileSync(GENERATED_PATH, "utf8"))).toEqual(fresh);
  });

  it("every tenant-keyed model has a manifest entry, and the manifest names no other model", () => {
    const listed = Object.keys(manifest).sort();
    const missing = tenantModels.filter((m) => !(m in manifest));
    const extra = listed.filter((m) => !tenantModels.includes(m));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("every entry covers every surface with a probe id, none(reason) or pending(card)", () => {
    const problems: string[] = [];
    for (const [model, entry] of Object.entries(manifest) as [string, ModelCoverage][]) {
      for (const s of SURFACES) {
        const c = entry[s];
        if (c === undefined) {
          problems.push(`${model}.${s}: missing`);
          continue;
        }
        const k = kindOf(c);
        if (k === "probe") {
          const r = probeExists(c as string);
          if (!r.ok) problems.push(`${model}.${s}: ${r.why}`);
        } else if (k === "none") {
          if (!(c as { none: string }).none.trim()) problems.push(`${model}.${s}: none needs a reason`);
        } else if (!(PENDING_CARDS as readonly string[]).includes((c as { pending: string }).pending)) {
          problems.push(`${model}.${s}: unknown pending card ${(c as { pending: string }).pending}`);
        }
      }
      for (const key of Object.keys(entry)) {
        if (!(SURFACES as readonly string[]).includes(key)) problems.push(`${model}: unknown surface ${key}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("reports covered / none / pending (pending is never counted as covered)", () => {
    const tally: Record<Kind, number> = { probe: 0, none: 0, pending: 0 };
    const byCard: Record<string, number> = {};
    for (const entry of Object.values(manifest)) {
      for (const s of SURFACES) {
        const k = kindOf(entry[s]);
        tally[k]++;
        if (k === "pending") {
          const card = (entry[s] as { pending: string }).pending;
          byCard[card] = (byCard[card] ?? 0) + 1;
        }
      }
    }
    const total = tenantModels.length * SURFACES.length;
    // vitest.config sets silent:true (console swallowed); stderr is passed through so CI logs show the count.
    process.stderr.write(
      `CC-13 coverage: ${tenantModels.length} tenant models x ${SURFACES.length} surfaces = ${total} cells; ` +
        `probed ${tally.probe}, none ${tally.none}, PENDING ${tally.pending} ${JSON.stringify(byCard)}\n`
    );
    expect(tally.probe + tally.none + tally.pending).toBe(total);
  });

  it("probe-id resolver rejects a missing file and a missing test name", () => {
    expect(probeExists("apps/web/test/cc13/nope.integration-test.ts > x").ok).toBe(false);
    expect(probeExists("packages/prisma/conformance/cc13/coverage.test.ts > x").ok).toBe(false);
    expect(probeExists("no separator").ok).toBe(false);
    expect(probeExists("apps/web/test/cc13/seed.integration-test.ts > seeds two disjoint tenants").ok).toBe(
      true
    );
  });
});
