/**
 * TW-T9.2b4 — entry-point audit (CC-13, WC-30 step 5).
 *
 * Every HTTP entry point that can reach the database must run in a tw org context:
 *   - it imports from packages/lib/server/tw-org-scope/*, or
 *   - it goes through a wrapped responder (defaultResponder / defaultResponderForAppDir,
 *     both wrap with withSessionTwOrg), or
 *   - it is an API v2 controller (global TwOrgScopeInterceptor), or
 *   - it is an app-store api handler reached only through
 *     apps/web/pages/api/integrations/[...args].ts (wrapped with withSessionTwOrg),
 * otherwise it must be listed in scripts/tw-t9/entrypoint-allowlist.json with a reason.
 * The test fails on any unlisted file and on any stale allowlist entry.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../../..");
const ALLOWLIST = "scripts/tw-t9/entrypoint-allowlist.json";

const IGNORED = (rel: string) =>
  /(^|\/)(node_modules|__tests__)\//.test(rel) || /\.(test|spec)\.tsx?$|\.d\.ts$/.test(rel);

function walk(dirRel: string): string[] {
  const abs = path.join(ROOT, dirRel);
  if (!existsSync(abs)) return [];
  return (readdirSync(abs, { recursive: true, withFileTypes: false }) as string[])
    .map((p) => path.posix.join(dirRel, p.split(path.sep).join("/")))
    .filter((rel) => /\.tsx?$/.test(rel) && !IGNORED(rel));
}

// apps/web/app/api/**/route.ts, apps/web/pages/api/**, apps/api/v2/src/**/*.controller.ts,
// packages/app-store/*/api/** (crons live under apps/web/app/api/cron/** and are included).
const ENTRY_SETS: Array<[string, (rel: string) => boolean]> = [
  ["apps/web/app/api", (rel) => rel.endsWith("/route.ts")],
  ["apps/web/pages/api", () => true],
  ["apps/api/v2/src", (rel) => rel.endsWith(".controller.ts")],
  ["packages/app-store", (rel) => /^packages\/app-store\/[^/]+\/api\//.test(rel)],
];

// A value (non-type) import of the prisma client, or a v2 prisma service.
const DB_ACCESS = [
  /^import\s+(?!type\b)prisma\b[^;]*from\s+["']@calcom\/prisma["']/m,
  /^import\s+(?!type\b)(?:[\w$]+\s*,\s*)?\{[^}]*(?<!type\s)\bprisma\b[^}]*\}\s*from\s+["']@calcom\/prisma["']/m,
  /^import\s+(?!type\b)\{[^}]*(?<!type\s)\bPrismaClient\b[^}]*\}\s*from\s+["'](?:@calcom\/prisma\/client|@prisma\/client)["']/m,
  /\bnew PrismaClient\(/,
  /\bPrisma(?:Read|Write)Service\b/,
];
const SCOPE_IMPORT = /from\s+["'][^"']*\/tw-org-scope\/[\w-]+["']/;
const WRAPPED_RESPONDER = /\bdefaultResponder(?:ForAppDir)?\(/;

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

type Allow = { path: string; reason: string };

function entryFiles(): string[] {
  const out = new Set<string>();
  for (const [dir, keep] of ENTRY_SETS) for (const f of walk(dir)) if (keep(f)) out.add(f);
  return [...out].sort();
}

/** app-store api modules re-exported directly by a pages/api route (bypassing [...args]). */
function directlyRoutedAppStoreFiles(): Set<string> {
  const out = new Set<string>();
  for (const f of walk("apps/web/pages/api")) {
    for (const m of read(f).matchAll(/from\s+["']@calcom\/app-store\/([^"']+)["']/g)) {
      out.add(`packages/app-store/${m[1]}.ts`);
    }
  }
  return out;
}

export function auditEntryPoints() {
  const direct = directlyRoutedAppStoreFiles();
  const argsRouterWrapped = /export default withSessionTwOrg\(/.test(
    read("apps/web/pages/api/integrations/[...args].ts")
  );
  const unscoped: string[] = [];
  let withDb = 0;
  for (const f of entryFiles()) {
    const src = read(f);
    if (!DB_ACCESS.some((re) => re.test(src))) continue;
    withDb++;
    if (SCOPE_IMPORT.test(src) || WRAPPED_RESPONDER.test(src)) continue;
    if (f.startsWith("apps/api/v2/") && f.endsWith(".controller.ts")) continue;
    if (f.startsWith("packages/app-store/") && argsRouterWrapped && !direct.has(f)) continue;
    unscoped.push(f);
  }
  return { unscoped, withDb };
}

describe("TW-T9.2b4 entry-point audit", () => {
  it("the wrappers the audit relies on are in place", () => {
    expect(read("packages/lib/server/defaultResponder.ts")).toMatch(/withSessionTwOrg\(handle\)/);
    expect(read("apps/web/app/api/defaultResponderForAppDir.ts")).toMatch(/withSessionTwOrg\(routeHandler\)/);
    expect(read("apps/web/pages/api/integrations/[...args].ts")).toMatch(/export default withSessionTwOrg\(/);
    expect(read("apps/api/v2/src/app.module.ts")).toMatch(
      /provide:\s*APP_INTERCEPTOR,\s*useClass:\s*TwOrgScopeInterceptor/
    );
  });

  it("every DB-reaching entry point is scoped or allowlisted with a reason", () => {
    const allow: Allow[] = JSON.parse(read(ALLOWLIST)).entries;
    for (const a of allow) expect(a.reason?.trim(), `${a.path}: reason required`).toBeTruthy();
    const { unscoped, withDb } = auditEntryPoints();
    expect(withDb).toBeGreaterThan(50); // sanity: the globs still find the entry points
    const allowed = new Set(allow.map((a) => a.path));
    expect(
      unscoped.filter((f) => !allowed.has(f)),
      "unscoped entry points (wrap or allowlist)"
    ).toEqual([]);
  });

  it("the allowlist has no stale entries", () => {
    const allow: Allow[] = JSON.parse(read(ALLOWLIST)).entries;
    const { unscoped } = auditEntryPoints();
    const stale = allow.filter((a) => !existsSync(path.join(ROOT, a.path)) || !unscoped.includes(a.path));
    expect(
      stale.map((a) => a.path),
      "stale allowlist entries (remove them)"
    ).toEqual([]);
  });
});
