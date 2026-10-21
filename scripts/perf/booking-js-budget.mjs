#!/usr/bin/env node
// WC-TW-6c gate (a): gzip size of the JS a first load of the public booking route pulls in.
// Reads the <script src> list from the server-rendered HTML instead of build manifests, so the
// number is what a browser actually downloads and stays valid across webpack/Turbopack builds.
// Usage: node scripts/perf/booking-js-budget.mjs --url http://localhost:3000/pro/30min \
//          [--static-dir apps/web/.next/static] [--budget-kb 200] [--out perf/js-budget.json]
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), all[i + 1]]);
    return acc;
  }, [])
);

const url = args.url;
if (!url) {
  console.error("--url is required");
  process.exit(2);
}
const staticDir = args["static-dir"] ?? "apps/web/.next/static";
const budgetKb = Number(args["budget-kb"] ?? process.env.BOOKING_JS_BUDGET_KB ?? 200);
const out = args.out ?? "perf/js-budget.json";
const region = args.region ?? "gh-runner";

export function scriptSrcs(html) {
  const srcs = new Set();
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js[^"]*)"/g)) srcs.add(m[1]);
  // Turbopack/app-router preloads chunks with <link rel="preload" as="script"> before the tags.
  for (const m of html.matchAll(/<link\b[^>]*\bas="script"[^>]*\bhref="([^"]+\.js[^"]*)"/g)) srcs.add(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\bhref="([^"]+\.js[^"]*)"[^>]*\bas="script"/g)) srcs.add(m[1]);
  return [...srcs];
}

async function loadBytes(src) {
  const path = new URL(src, url).pathname;
  const prefix = "/_next/static/";
  if (path.startsWith(prefix)) {
    const local = join(staticDir, decodeURIComponent(path.slice(prefix.length)));
    if (existsSync(local)) return { bytes: readFileSync(local), from: "disk" };
  }
  const res = await fetch(new URL(src, url));
  if (!res.ok) throw new Error(`GET ${src} -> ${res.status}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), from: "http" };
}

async function main() {
  const res = await fetch(url, { headers: { "user-agent": "timeway-perf-gate" } });
  if (res.status !== 200) throw new Error(`Booking route ${url} returned ${res.status}; the gate needs a real page`);
  const html = await res.text();
  const srcs = scriptSrcs(html);
  if (srcs.length === 0) throw new Error(`No <script src> found on ${url}; refusing to report 0 KB`);

  const files = [];
  for (const src of srcs) {
    const { bytes, from } = await loadBytes(src);
    files.push({ src, raw: bytes.length, gz: gzipSync(bytes, { level: 9 }).length, from });
  }
  files.sort((a, b) => b.gz - a.gz);
  const totalGz = files.reduce((s, f) => s + f.gz, 0);
  const totalRaw = files.reduce((s, f) => s + f.raw, 0);
  const totalKb = totalGz / 1024;
  const pass = totalKb <= budgetKb;

  const result = {
    gate: "booking-js-budget",
    region,
    url,
    commit: process.env.GITHUB_SHA ?? null,
    measured_at: new Date().toISOString(),
    budget_kb_gz: budgetKb,
    total_kb_gz: Number(totalKb.toFixed(1)),
    total_kb_raw: Number((totalRaw / 1024).toFixed(1)),
    scripts: files.length,
    pass,
    files,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);

  const kb = (n) => (n / 1024).toFixed(1);
  const lines = [
    `### Booking route JS budget (region=${region})`,
    "",
    `\`${url}\` first load: **${totalKb.toFixed(1)} KB gz** / budget ${budgetKb} KB — ${pass ? "PASS" : "FAIL"}`,
    "",
    "| script | gz KB | raw KB |",
    "| --- | ---: | ---: |",
    ...files.map((f) => `| \`${f.src.split("?")[0]}\` | ${kb(f.gz)} | ${kb(f.raw)} |`),
    `| **total (${files.length})** | **${kb(totalGz)}** | ${kb(totalRaw)} |`,
    "",
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  if (!pass) {
    console.error(`::error::Booking route ships ${totalKb.toFixed(1)} KB gz of JS, over the ${budgetKb} KB budget`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`::error::${err.message}`);
  process.exit(1);
});
