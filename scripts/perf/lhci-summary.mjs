#!/usr/bin/env node
// WC-TW-6c: turn an LHCI filesystem upload into the CC-56 region-tagged evidence record.
// Usage: node scripts/perf/lhci-summary.mjs --dir perf/out/lhci --region gh-runner --out perf/out/lhci-gh-runner.json
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), all[i + 1]]);
    return acc;
  }, [])
);
const dir = args.dir ?? "perf/out/lhci";
const region = args.region ?? "gh-runner";
const out = args.out ?? `perf/out/lhci-${region}.json`;
const { limits, region: regionInfo } = createRequire(import.meta.url)(
  resolve(args.config ?? "perf/lighthouserc.cjs")
);
if (regionInfo.region !== region) {
  console.error(`::error::--region ${region} but the config ran as LHCI_REGION=${regionInfo.region}`);
  process.exit(1);
}
const gate = (l, abs) => (l.ratchet ? `< ${l.max} error (ratchet), < ${abs} warn` : `< ${l.max} error`);

const AUDITS = {
  lcp_ms: "largest-contentful-paint",
  tbt_ms: "total-blocking-time",
  ttfb_ms: "server-response-time",
  fcp_ms: "first-contentful-paint",
  cls: "cumulative-layout-shift",
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
if (!manifest.length) {
  console.error("::error::LHCI manifest is empty; no Lighthouse run to report");
  process.exit(1);
}

const runs = manifest.map((entry) => {
  const lhr = JSON.parse(readFileSync(entry.jsonPath, "utf8"));
  const metrics = Object.fromEntries(
    Object.entries(AUDITS).map(([k, id]) => [k, lhr.audits[id]?.numericValue ?? null])
  );
  return {
    url: entry.url,
    representative: entry.isRepresentativeRun,
    performance_score: lhr.categories.performance?.score ?? null,
    form_factor: lhr.configSettings.formFactor,
    throttling: lhr.configSettings.throttling,
    lighthouse_version: lhr.lighthouseVersion,
    // Runner CPU score; TBT scales with it (WC-TW-6c-12: ~2400 runners give ~2x the TBT of ~4000 ones).
    benchmark_index: lhr.environment?.benchmarkIndex ?? null,
    ...metrics,
  };
});

const med = Object.fromEntries(
  Object.keys(AUDITS).map((k) => {
    const vals = runs.map((r) => r[k]).filter((v) => typeof v === "number");
    return [k, vals.length ? Number(median(vals).toFixed(k === "cls" ? 3 : 0)) : null];
  })
);

const result = {
  gate: "booking-lighthouse",
  region,
  url: runs[0].url,
  network: {
    provider: region === "gh-runner" ? null : "globalping",
    city_rtt_ms: regionInfo.city_rtt_ms || null,
    simulated_rtt_ms: runs[0].throttling?.rttMs ?? null,
    note:
      region === "gh-runner"
        ? "Lighthouse default slow-4G on a GitHub runner"
        : "Lighthouse on a GitHub runner, simulated RTT = slow-4G 150 ms + city RTT measured from this region. " +
          "city_rtt_ms is ICMP RTT from the city probe to the Cloudflare anycast edge only; the edge-to-origin leg is " +
          "not modelled, so this underestimates real latency. Real-network TTFB per city = region-ttfb artifact.",
  },
  commit: process.env.GITHUB_SHA ?? null,
  measured_at: new Date().toISOString(),
  runs: runs.length,
  median: med,
  thresholds: {
    lcp_error_ms: limits.lcp.max,
    lcp_ratchet: limits.lcp.ratchet,
    lcp_absolute_ms: limits.absolute.lcp_ms,
    lcp_warn_ms: 1500,
    tbt_error_ms: limits.tbt.max,
    tbt_ratchet: limits.tbt.ratchet,
    tbt_absolute_ms: limits.absolute.tbt_ms,
    ttfb_warn_ms: 500,
  },
  runs_detail: runs,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);

const lines = [
  `### Lighthouse booking page (region=${region}, ${runs.length} runs, median)`,
  "",
  `\`${result.url}\` — ${runs[0].form_factor}, simulated throttling RTT ${runs[0].throttling?.rttMs} ms / ${runs[0].throttling?.throughputKbps} kbps`,
  "",
  "| metric | median | gate |",
  "| --- | ---: | --- |",
  `| LCP | ${med.lcp_ms} ms | ${gate(limits.lcp, limits.absolute.lcp_ms)}, <= 1500 warn |`,
  `| TBT (INP proxy) | ${med.tbt_ms} ms | ${gate(limits.tbt, limits.absolute.tbt_ms)} |`,
  `| TTFB | ${med.ttfb_ms} ms | < 500 warn |`,
  `| FCP | ${med.fcp_ms} ms | — |`,
  `| CLS | ${med.cls} | — |`,
  `| runner benchmarkIndex | ${median(runs.map((r) => r.benchmark_index ?? 0))} | — |`,
  "",
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
