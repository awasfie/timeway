#!/usr/bin/env node
// WC-TW-1 (Bible v12.6 WC.2.4, proof CC-63): fail CI when the lineage security fixes regress.
// 1) Version floors, read from yarn.lock: every resolved copy must be at or above the patched
//    release of its own release line (CVE-2025-55182 / CVE-2025-66478, GHSA-qjx2-5xqp-cpf4).
// 2) Source guards for the cal.com advisories that are fixed in our code, not in a dependency.
// No network, no secrets. Usage: node scripts/security/lineage-floor.mjs [repoRoot]
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? process.cwd();
const failures = [];
const passes = [];

// [package, list of [lineMin, lineMax(exclusive), floor]]
const FLOORS = {
  // GHSA-9qr9-h5gf-34mp (CVE-2025-66478): Next.js RSC flight-protocol RCE.
  next: [
    ["14.3.0", "15.0.0", "15.0.5"], // 14.3 canaries were affected; no 14.3 stable fix: must move to >= 15.0.5
    ["15.0.0", "15.1.0", "15.0.5"],
    ["15.1.0", "15.2.0", "15.1.9"],
    ["15.2.0", "15.3.0", "15.2.6"],
    ["15.3.0", "15.4.0", "15.3.6"],
    ["15.4.0", "15.5.0", "15.4.8"],
    ["15.5.0", "16.0.0", "15.5.7"],
    ["16.0.0", "99.0.0", "16.0.7"],
  ],
  // GHSA-fv66-9v8q-g76r (CVE-2025-55182): React Server Components RCE.
  "react-server-dom-webpack": [
    ["19.0.0", "19.1.0", "19.0.1"],
    ["19.1.0", "19.2.0", "19.1.2"],
    ["19.2.0", "99.0.0", "19.2.1"],
  ],
  "react-server-dom-turbopack": [
    ["19.0.0", "19.1.0", "19.0.1"],
    ["19.1.0", "19.2.0", "19.1.2"],
    ["19.2.0", "99.0.0", "19.2.1"],
  ],
  "react-server-dom-parcel": [
    ["19.0.0", "19.1.0", "19.0.1"],
    ["19.1.0", "19.2.0", "19.1.2"],
    ["19.2.0", "99.0.0", "19.2.1"],
  ],
  // Pinned baseline at the time of WC-TW-1; a downgrade below it fails.
  "next-auth": [["0.0.0", "99.0.0", "4.24.15"]],
};

const parse = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v);
  if (!m) return null;
  return { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
};
const cmp = (a, b) => {
  for (let i = 0; i < 3; i++) if (a.n[i] !== b.n[i]) return a.n[i] - b.n[i];
  if (a.pre && !b.pre) return -1; // prerelease sorts below the release
  if (!a.pre && b.pre) return 1;
  return 0;
};

export function resolvedVersions(lock, pkg) {
  const out = new Set();
  const re = new RegExp(`^"?${pkg.replace(/[/.]/g, "\\$&")}@npm:[^\\n]*:\\n\\s+version: ([^\\s]+)`, "gm");
  let m;
  while ((m = re.exec(lock))) out.add(m[1]);
  return [...out];
}

export function checkFloor(pkg, version) {
  const v = parse(version);
  if (!v) return `unparseable version ${version}`;
  for (const [lo, hi, floor] of FLOORS[pkg]) {
    const L = parse(lo);
    const H = parse(hi);
    const base = { n: v.n, pre: null };
    if (cmp(base, L) >= 0 && cmp(base, H) < 0) {
      return cmp(v, parse(floor)) >= 0 ? null : `${pkg}@${version} < ${floor}`;
    }
  }
  return null; // outside every affected line
}

const lock = readFileSync(join(root, "yarn.lock"), "utf8");
for (const pkg of Object.keys(FLOORS)) {
  const versions = resolvedVersions(lock, pkg);
  for (const version of versions) {
    const err = checkFloor(pkg, version);
    if (err) failures.push(`floor: ${err}`);
    else passes.push(`floor: ${pkg}@${version} ok`);
  }
  if (pkg === "next" && versions.length === 0) failures.push("floor: next not found in yarn.lock");
}

const read = (p) => readFileSync(join(root, p), "utf8");
const guards = [
  {
    id: "GHSA-9r3w-4j8q-pw98 (CVE-2025-66489) password always verified",
    file: "packages/features/auth/lib/next-auth-options.ts",
    must: [/const isCorrectPassword = await verifyPassword\(credentials\.password, user\.password\.hash\);/],
    mustNot: [/if \(user\.password\?\.hash && !credentials\.totpCode\)/],
  },
  {
    id: "GHSA-7hg4-x4pr-3hrg (CVE-2026-23478) jwt update email validated",
    file: "packages/features/auth/lib/next-auth-options.ts",
    must: [/email: await resolveUpdatedTokenEmail\(token, session\?\.email\)/],
    mustNot: [/email: session\?\.email \?\? token\.email/],
  },
  {
    id: "GHSA-7hg4-x4pr-3hrg (CVE-2026-23478) server session resolved by token.sub",
    file: "packages/features/auth/lib/getServerSession.ts",
    must: [/where: \{ id: userId \}/],
    mustNot: [/where: \{ email \}/],
  },
  {
    id: "GHSA-7hg4-x4pr-3hrg (CVE-2026-23478) API v2 NextAuth strategy resolved by token.sub",
    file: "apps/api/v2/src/modules/auth/strategies/api-auth/api-auth.strategy.ts",
    must: [/findByIdWithProfile\(userId\)/],
    mustNot: [/findByEmailWithProfile\(token\.email\)/],
  },
  {
    id: "GHSA-7hg4-x4pr-3hrg (CVE-2026-23478) API v2 next-auth strategy resolved by token.sub",
    file: "apps/api/v2/src/modules/auth/strategies/next-auth/next-auth.strategy.ts",
    must: [/findByIdWithProfile\(userId\)/],
    mustNot: [/findByEmailWithProfile\(payload\.email\)/],
  },
  {
    id: "GHSA-vgj7-76cw-h6f8 booking-question labels sanitized",
    file: "apps/web/modules/bookings/views/bookings-single-view.tsx",
    must: [/__html: markdownToSafeHTML\(label\)/],
    mustNot: [/__html: label\b/],
  },
];
for (const g of guards) {
  const src = read(g.file);
  const ok = g.must.every((r) => r.test(src)) && !g.mustNot.some((r) => r.test(src));
  (ok ? passes : failures).push(`source: ${g.id} (${g.file})`);
}

for (const p of passes) console.log(`PASS ${p}`);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`lineage-floor: ${passes.length} pass, ${failures.length} fail`);
process.exit(failures.length ? 1 : 0);
