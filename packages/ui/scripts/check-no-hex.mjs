#!/usr/bin/env node
// UX.0.10 / UX-T0: no brand hex literals outside the token files.
// Scans the brand surfaces (preview page + token files' neighbours) for #rgb/#rrggbb/#rrggbbaa;
// only packages/ui/brand-tokens.ts and packages/config/theme/brand-timeway.css may contain them.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const allowed = new Set(["packages/ui/brand-tokens.ts", "packages/config/theme/brand-timeway.css"].map((p) => resolve(repo, p)));
const roots = (process.argv.slice(2).length ? process.argv.slice(2) : ["apps/web/app/brand-preview"]).map((p) => resolve(repo, p));
const hex = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g;
function* walk(p) {
  if (statSync(p).isFile()) { yield p; return; }
  for (const n of readdirSync(p)) { if (n === "node_modules") continue; yield* walk(join(p, n)); }
}
const hits = [];
for (const root of roots) {
  if (!existsSync(root)) continue;
  for (const f of walk(root)) {
    if (!/\.(tsx?|css)$/.test(f) || allowed.has(resolve(f))) continue;
    readFileSync(f, "utf8").split("\n").forEach((l, i) => { for (const m of l.matchAll(hex)) hits.push(`${relative(repo, f)}:${i + 1}: ${m[0]}`); });
  }
}
if (hits.length) { console.error(`no-hex: ${hits.length} violation(s):\n${hits.join("\n")}`); process.exit(1); }
console.log("no-hex: OK");
