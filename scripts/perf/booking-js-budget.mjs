#!/usr/bin/env node
// WC-TW-6c gate (a): gzip size of the JS a first load of the public booking route pulls in.
// Reads the <script src> list from the server-rendered HTML instead of build manifests, so the
// number is what a browser actually downloads and stays valid across webpack/Turbopack builds.
// Usage: node scripts/perf/booking-js-budget.mjs --url http://localhost:3000/pro/30min \
//          [--static-dir apps/web/.next/static] [--budget-kb 200] [--baseline perf/js-baseline.json] \
//          [--out perf/js-budget.json] [--forbid "label=marker;label=marker"]
// --forbid: modules that must stay off the first load, each identified by a string literal only
// that module ships (chunk names are hashes, so the bytes are the only stable evidence).
// Two verdicts: RATCHET (enforced) — total must not exceed the committed baseline + tolerance;
// BUDGET (absolute) — always reported, enforced only once the baseline itself is within budget.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
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
const baselinePath = args.baseline ?? "perf/js-baseline.json";
const forbidden = (args.forbid ?? "")
  .split(";")
  .filter(Boolean)
  .map((pair) => {
    const at = pair.indexOf("=");
    return { label: pair.slice(0, at), marker: pair.slice(at + 1) };
  });
if (!existsSync(baselinePath)) {
  console.error(`::error::JS baseline ${baselinePath} missing; the ratchet cannot run`);
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const baselineKb = Number(baseline.total_kb_gz);
const toleranceKb = Number(baseline.tolerance_kb ?? 5);
if (!Number.isFinite(baselineKb) || baselineKb <= 0) {
  console.error(`::error::JS baseline ${baselinePath} has no positive total_kb_gz`);
  process.exit(1);
}

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
  if (!existsSync(staticDir))
    throw new Error(`Build output ${staticDir} missing; refusing to measure without a build`);
  const res = await fetch(url, { headers: { "user-agent": "timeway-perf-gate" } });
  if (res.status !== 200)
    throw new Error(`Booking route ${url} returned ${res.status}; the gate needs a real page`);
  const html = await res.text();
  const srcs = scriptSrcs(html);
  if (srcs.length === 0) throw new Error(`No <script src> found on ${url}; refusing to report 0 KB`);

  const files = [];
  const forbidHits = forbidden.map((f) => ({ ...f, found_in: [] }));
  for (const src of srcs) {
    const { bytes, from } = await loadBytes(src);
    files.push({ src, raw: bytes.length, gz: gzipSync(bytes, { level: 9 }).length, from });
    const text = bytes.toString("utf8");
    for (const hit of forbidHits) if (text.includes(hit.marker)) hit.found_in.push(src.split("?")[0]);
  }
  const forbidOk = forbidHits.every((h) => h.found_in.length === 0);
  files.sort((a, b) => b.gz - a.gz);
  const totalGz = files.reduce((s, f) => s + f.gz, 0);
  const totalRaw = files.reduce((s, f) => s + f.raw, 0);
  const totalKb = totalGz / 1024;
  const budgetOk = totalKb <= budgetKb;
  const ratchetMaxKb = baselineKb + toleranceKb;
  const ratchetOk = totalKb <= ratchetMaxKb;
  const budgetEnforced = baselineKb <= budgetKb;
  const pass = ratchetOk && (budgetOk || !budgetEnforced) && forbidOk;

  const result = {
    gate: "booking-js-budget",
    region,
    url,
    commit: process.env.GITHUB_SHA ?? null,
    measured_at: new Date().toISOString(),
    total_kb_gz: Number(totalKb.toFixed(1)),
    ratchet: {
      baseline_kb_gz: baselineKb,
      tolerance_kb: toleranceKb,
      max_kb_gz: Number(ratchetMaxKb.toFixed(1)),
      delta_kb_gz: Number((totalKb - baselineKb).toFixed(1)),
      status: ratchetOk ? "ok" : "breach",
      enforced: true,
    },
    budget: { budget_kb_gz: budgetKb, status: budgetOk ? "ok" : "breach", enforced: budgetEnforced },
    total_kb_raw: Number((totalRaw / 1024).toFixed(1)),
    scripts: files.length,
    forbidden: forbidHits,
    pass,
    files,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);

  const kb = (n) => (n / 1024).toFixed(1);
  const lines = [
    `### Booking route JS budget (region=${region})`,
    "",
    `\`${url}\` first load: **${totalKb.toFixed(1)} KB gz** in ${files.length} scripts — ${pass ? "PASS" : "FAIL"}`,
    "",
    "| check | limit | status | enforced |",
    "| --- | ---: | --- | --- |",
    `| ratchet (baseline ${baselineKb} + ${toleranceKb} KB) | ${ratchetMaxKb.toFixed(1)} KB | ${ratchetOk ? "ok" : "breach"} (${totalKb - baselineKb >= 0 ? "+" : ""}${(totalKb - baselineKb).toFixed(1)} KB) | yes |`,
    `| budget | ${budgetKb} KB | ${budgetOk ? "ok" : "breach"} | ${budgetEnforced ? "yes" : "no, until baseline <= budget"} |`,
    ...forbidHits.map((h) => {
      const status = h.found_in.length === 0 ? "ok" : `breach (${h.found_in.join(", ")})`;
      return `| off first load: ${h.label} | 0 chunks | ${status} | yes |`;
    }),
    "",
    "| script | gz KB | raw KB |",
    "| --- | ---: | ---: |",
    ...files.map((f) => `| \`${f.src.split("?")[0]}\` | ${kb(f.gz)} | ${kb(f.raw)} |`),
    `| **total (${files.length})** | **${kb(totalGz)}** | ${kb(totalRaw)} |`,
    "",
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  if (!budgetOk) {
    const level = budgetEnforced ? "error" : "warning";
    console.error(
      `::${level}::Booking route ships ${totalKb.toFixed(1)} KB gz of JS, over the ${budgetKb} KB budget`
    );
  }
  if (!ratchetOk) {
    console.error(
      `::error::Booking route JS grew to ${totalKb.toFixed(1)} KB gz, over the ratchet ${ratchetMaxKb.toFixed(1)} KB (baseline ${baselineKb} + ${toleranceKb}) in ${baselinePath}`
    );
  }
  for (const h of forbidHits.filter((x) => x.found_in.length))
    console.error(`::error::${h.label} is back on the booking first load: ${h.found_in.join(", ")}`);
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error(`::error::${err.message}`);
  process.exit(1);
});
