import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const DOC = join(__dirname, "../../../docs/api/provisioning.md");

function block(): string {
  const m = readFileSync(DOC, "utf8").match(/```yaml openapi\n([\s\S]*?)\n```/);
  if (!m) throw new Error("no ```yaml openapi block in docs/api/provisioning.md");
  return m[1];
}

function refs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => refs(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string") out.push(v);
      else refs(v, out);
    }
  }
  return out;
}

describe("docs/api/provisioning.md OpenAPI block (WC-TW-14e)", () => {
  const doc = yaml.load(block()) as Record<string, any>;

  it("parses as OpenAPI 3.1", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/orgs", "/orgs/{orgId}", "/orgs/{orgId}/sub-orgs", "/orgs/{orgId}/sub-orgs/{subId}"])
    );
  });

  it("every $ref resolves", () => {
    for (const r of refs(doc)) {
      const target = r.replace(/^#\//, "").split("/").reduce((n: any, k) => n?.[k], doc);
      expect(target, r).toBeDefined();
    }
  });

  it("every operation has an id and responses", () => {
    const ids = new Set<string>();
    for (const item of Object.values<any>(doc.paths))
      for (const [verb, op] of Object.entries<any>(item)) {
        if (!["get", "post", "put", "patch", "delete"].includes(verb)) continue;
        expect(op.operationId).toBeTruthy();
        expect(ids.has(op.operationId)).toBe(false);
        ids.add(op.operationId);
        expect(Object.keys(op.responses).length).toBeGreaterThan(0);
      }
  });

  it("documents no prices", () => {
    expect(block()).not.toMatch(/[$€£]\s?\d|\bUSD\b|\bAED\b/);
  });
});
