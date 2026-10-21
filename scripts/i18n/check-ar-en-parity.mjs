#!/usr/bin/env node
// R1-TW-AREN-a (R-61): en -> ar key parity gate. Other locales are out of scope.
// Fails on: en key missing in ar, differing {{placeholder}} sets, differing tag sets.
// Byte-identical values are reported as warnings only (brand names, codes and URLs legitimately match).
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

export function placeholders(value) {
  if (typeof value !== "string") return [];
  const names = [...value.matchAll(/{{\s*([^,}\s]+)[^}]*}}/g)].map((m) => m[1]);
  return [...new Set(names)].sort();
}

export function tags(value) {
  if (typeof value !== "string") return [];
  const found = [...value.matchAll(/<\s*(\/?)\s*([a-zA-Z0-9]+)\s*(\/?)\s*>/g)].map(
    (m) => `<${m[1]}${m[2]}${m[3]}>`
  );
  return [...new Set(found)].sort();
}

export function checkParity(enJson, arJson) {
  const en = flatten(enJson);
  const ar = flatten(arJson);
  const missing = [];
  const placeholderMismatches = [];
  const tagMismatches = [];
  const identical = [];
  for (const [key, enValue] of Object.entries(en)) {
    if (!(key in ar)) {
      missing.push(key);
      continue;
    }
    const arValue = ar[key];
    const pe = placeholders(enValue);
    const pa = placeholders(arValue);
    if (!same(pe, pa)) placeholderMismatches.push({ key, en: pe, ar: pa });
    const te = tags(enValue);
    const ta = tags(arValue);
    if (!same(te, ta)) tagMismatches.push({ key, en: te, ar: ta });
    if (typeof enValue === "string" && enValue === arValue) identical.push(key);
  }
  return { missing, placeholderMismatches, tagMismatches, identical };
}

export function formatReport(r) {
  const lines = [];
  for (const k of r.missing) lines.push(`MISSING ${k}`);
  for (const m of r.placeholderMismatches)
    lines.push(`PLACEHOLDER ${m.key} en=[${m.en.join(",")}] ar=[${m.ar.join(",")}]`);
  for (const m of r.tagMismatches) lines.push(`TAG ${m.key} en=[${m.en.join(",")}] ar=[${m.ar.join(",")}]`);
  for (const k of r.identical) lines.push(`warning: identical ${k}`);
  lines.push(
    `${r.missing.length} missing, ${r.placeholderMismatches.length} placeholder mismatches, ` +
      `${r.tagMismatches.length} tag mismatches, ${r.identical.length} identical (warning)`
  );
  return lines.join("\n");
}

export const failed = (r) => r.missing.length + r.placeholderMismatches.length + r.tagMismatches.length > 0;

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "packages/i18n/locales");
  const load = (loc) => JSON.parse(readFileSync(path.join(dir, loc, "common.json"), "utf8"));
  const report = checkParity(load("en"), load("ar"));
  console.log(formatReport(report));
  if (failed(report)) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
