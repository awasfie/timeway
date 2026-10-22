#!/usr/bin/env node
// WC-TW-6c gate (c) + WC.2.5 TTFB source: HTTPS GET of the booking page from Cairo, Riyadh and
// Dubai via Globalping (public probe network, free tier; GLOBALPING_TOKEN raises the rate limit).
// A missing city or a provider error fails the run: a gate is never satisfied by a skip.
// Usage: node scripts/perf/region-ttfb.mjs --url https://timeway.co/ahmedwasfie/30min \
//          [--budget-ms 500] [--samples 2] [--probes 3] [--out perf/out/region-ttfb.json]
// Each sample asks Globalping for up to --probes probes in the city and keeps the ones that answer;
// a city fails only when no probe answers in any attempt.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), all[i + 1]]);
    return acc;
  }, [])
);
const target = new URL(args.url ?? "https://timeway.co/ahmedwasfie/30min");
const budgetMs = Number(args["budget-ms"] ?? 500);
const samples = Number(args.samples ?? 2);
const probes = Number(args.probes ?? 3);
const out = args.out ?? "perf/out/region-ttfb.json";
const enforce = (args.enforce ?? "true") === "true";

export const REGIONS = [
  { region: "cairo", magic: "Cairo+EG" },
  { region: "riyadh", magic: "Riyadh+SA" },
  { region: "dubai", magic: "Dubai+AE" },
];

const API = "https://api.globalping.io/v1/measurements";
const headers = { "content-type": "application/json" };
if (process.env.GLOBALPING_TOKEN) headers.authorization = `Bearer ${process.env.GLOBALPING_TOKEN}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const probeOf = (r) => ({
  city: r?.probe?.city ?? null,
  network: r?.probe?.network ?? null,
  asn: r?.probe?.asn ?? null,
});

// Returns every probe result that finished; failed probes are pushed to `failures` with their ASN.
async function measure(loc, failures) {
  const body = {
    type: "http",
    target: target.hostname,
    locations: [{ magic: loc.magic, limit: probes }],
    measurementOptions: {
      protocol: "HTTPS",
      request: { method: "GET", path: target.pathname, query: target.search.replace(/^\?/, "") || undefined },
    },
  };
  const res = await fetch(API, { method: "POST", headers, body: JSON.stringify(body) });
  const created = await res.json();
  if (!res.ok || !created.id)
    throw new Error(`Globalping create for ${loc.region}: ${res.status} ${JSON.stringify(created)}`);
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const m = await (await fetch(`${API}/${created.id}`)).json();
    if (m.status === "in-progress") continue;
    const ok = [];
    for (const r of m.results ?? []) {
      if (r.result?.status !== "finished") {
        failures.push({
          region: loc.region,
          measurement_id: created.id,
          ...probeOf(r),
          status: r.result?.status ?? "missing",
          error: (r.result?.rawOutput ?? "").slice(0, 200),
        });
        continue;
      }
      const h = r.result.headers ?? {};
      ok.push({
        measurement_id: created.id,
        ...probeOf(r),
        country: r.probe.country,
        status_code: r.result.statusCode,
        timings: r.result.timings,
        cf_ray: [h["cf-ray"]].flat()[0] ?? null,
        server_timing: [h["server-timing"] ?? []].flat(),
      });
    }
    if (!ok.length)
      throw new Error(
        `${loc.region}: no probe answered in measurement ${created.id} (${(m.results ?? []).length} probes)`
      );
    return ok;
  }
  throw new Error(`${loc.region}: measurement ${created.id} did not finish in 30 s`);
}

// One flaky public probe must not fail the gate, a city with no working probe must.
async function measureWithRetry(loc, failures, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await measure(loc, failures);
    } catch (err) {
      last = err;
      failures.push({ region: loc.region, error: err.message });
      await sleep(2000);
    }
  }
  throw last;
}

const record = {
  gate: "booking-region-ttfb",
  provider: "globalping",
  commit: process.env.GITHUB_SHA ?? null,
  budget_enforced: enforce,
};

function writeRecord() {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
}

async function main() {
  const results = [];
  const failures = [];
  record.results = results;
  record.probe_failures = failures;
  for (const loc of REGIONS) {
    const rows = [];
    for (let i = 0; i < samples; i++) rows.push(...(await measureWithRetry(loc, failures)));
    const bad = rows.find((r) => r.status_code !== 200);
    if (bad) throw new Error(`${loc.region}: ${target} returned ${bad.status_code}`);
    const ttfbs = rows.map((r) => r.timings.firstByte);
    const ttfbMs = median(ttfbs);
    // firstByte is measured after TLS; cfOrigin isolates the origin share for the 6b/6a work.
    results.push({
      region: loc.region,
      url: target.href,
      ttfb_ms: ttfbMs,
      total_ms: median(rows.map((r) => r.timings.total)),
      budget_ms: budgetMs,
      pass: ttfbMs < budgetMs,
      probes: [
        ...new Map(
          rows.map((r) => [`${r.city}/${r.asn}`, { city: r.city, asn: r.asn, network: r.network }])
        ).values(),
      ],
      samples: rows,
    });
  }

  record.measured_at = new Date().toISOString();
  writeRecord();

  const lines = [
    `### Booking page TTFB by region (Globalping, median over ${samples} x up to ${probes} probes)`,
    "",
    `\`${target.href}\``,
    "",
    "| region | probe | TTFB ms | total ms | colo | gate |",
    "| --- | --- | ---: | ---: | --- | --- |",
    ...results.map(
      (r) =>
        `| ${r.region} | ${r.probes.map((p) => `${p.city} (${p.network} AS${p.asn})`).join(", ")} (n=${r.samples.length}) | ${r.ttfb_ms} | ${r.total_ms} | ${
          r.samples[0].cf_ray?.split("-")[1] ?? "?"
        } | ${r.pass ? "PASS" : "FAIL"} < ${budgetMs} |`
    ),
    "",
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    const msg = `TTFB over ${budgetMs} ms from ${failed.map((r) => `${r.region} ${r.ttfb_ms} ms`).join(", ")}`;
    console.error(`::${enforce ? "error" : "warning"}::${msg}`);
    if (enforce) process.exit(1);
  }
}

main().catch((err) => {
  record.measured_at = new Date().toISOString();
  record.error = err.message;
  writeRecord();
  console.error(`::error::${err.message}`);
  process.exit(1);
});
