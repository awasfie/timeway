#!/usr/bin/env node
// WC-TW-6c-10: measured network RTT from one city to the booking host, for the region-tagged
// Lighthouse run. Globalping (the region-ttfb provider) has public probes in Cairo, Riyadh and
// Dubai; no hosted Lighthouse provider has all three without a new paid account, so the Lighthouse
// run stays on the GitHub runner and its simulated network uses slow-4G (150 ms) + this city RTT.
// No answering probe, or a provider error, exits non-zero: the region job fails, never skips.
// Usage: node scripts/perf/region-rtt.mjs --region cairo --host timeway.co [--probes 3] [--out f.json]
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), all[i + 1]]);
    return acc;
  }, [])
);

const MAGIC = { cairo: "Cairo+EG", riyadh: "Riyadh+SA", dubai: "Dubai+AE" };
const region = args.region;
const host = args.host ?? "timeway.co";
const probes = Number(args.probes ?? 3);
const out = args.out ?? `perf/out/region-rtt-${region}.json`;
if (!MAGIC[region]) {
  console.error(`::error::unknown --region ${region}; expected ${Object.keys(MAGIC).join("|")}`);
  process.exit(2);
}

const API = "https://api.globalping.io/v1/measurements";
const headers = { "content-type": "application/json" };
if (process.env.GLOBALPING_TOKEN) headers.authorization = `Bearer ${process.env.GLOBALPING_TOKEN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

async function ping() {
  const body = {
    type: "ping",
    target: host,
    locations: [{ magic: MAGIC[region], limit: probes }],
    measurementOptions: { packets: 4 },
  };
  const res = await fetch(API, { method: "POST", headers, body: JSON.stringify(body) });
  const created = await res.json();
  if (!res.ok || !created.id) throw new Error(`Globalping create ${region}: ${res.status} ${JSON.stringify(created)}`);
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const m = await (await fetch(`${API}/${created.id}`)).json();
    if (m.status === "in-progress") continue;
    const ok = (m.results ?? [])
      .filter((r) => r.result?.status === "finished" && Number.isFinite(r.result?.stats?.avg))
      .map((r) => ({
        measurement_id: created.id,
        city: r.probe?.city ?? null,
        country: r.probe?.country ?? null,
        asn: r.probe?.asn ?? null,
        network: r.probe?.network ?? null,
        rtt_avg_ms: r.result.stats.avg,
        loss_pct: r.result.stats.loss,
      }));
    if (!ok.length) throw new Error(`${region}: no probe answered ping in measurement ${created.id}`);
    return ok;
  }
  throw new Error(`${region}: measurement ${created.id} did not finish in 30 s`);
}

let samples;
let lastErr;
for (let i = 0; i < 3 && !samples; i++) {
  try {
    samples = await ping();
  } catch (err) {
    lastErr = err;
    console.error(`::warning::${err.message}`);
    await sleep(2000);
  }
}
if (!samples) {
  console.error(`::error::region ${region}: provider unavailable after 3 attempts: ${lastErr?.message}`);
  process.exit(1);
}

const rtt = Math.round(median(samples.map((s) => s.rtt_avg_ms)));
const record = { region, provider: "globalping", host, rtt_median_ms: rtt, samples };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `rtt_ms=${rtt}\n`);
console.log(`region=${region} rtt_median_ms=${rtt} probes=${samples.length}`);
