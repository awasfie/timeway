// DESIGN-QA-CI (CC-56 as corrected by UX.13.10-2): UX.13.3 budgets per surface, Lighthouse
// default mobile profile (Moto G Power, simulated slow 4G), 5 runs, median. INP is field-only
// (web-vitals -> PostHog); the lab gate is TBT <= 200 ms.
// Ratchet (same rule as perf/lhci-baseline.json): while a surface's committed baseline is over
// its UX.13.3 budget, the error asserts baseline x (1 + tolerance) (a >10% regression fails, CC-56)
// and the budget itself drops to a warning. A surface without a baseline asserts the budget outright.
const fs = require("node:fs");
const path = require("node:path");
const { surfaces } = require("./surfaces.json");
const baselines = require("./lhci-baseline.json");
const base = (process.env.DESIGN_QA_BASE_URL || "https://timeway.co").replace(/\/$/, "");
// DESIGN_QA_TARGET=ci: the seeded PR build (ci_path) and its baseline set; otherwise the deployed site.
const target = process.env.DESIGN_QA_TARGET === "ci" ? "ci" : "deployed";
const pathOf = (s) => (target === "ci" ? s.ci_path : s.path);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const METRICS = {
  lcp_ms: { audit: "largest-contentful-paint", median: true },
  tbt_ms: { audit: "total-blocking-time", median: true },
  cls: { audit: "cumulative-layout-shift", median: true },
  js_kb: { audit: "resource-summary:script:size", scale: 1024 },
};

// Runner CPU class (CC-56, t_24fe7849): GitHub runners come in two classes and TBT on the same
// code differs ~1.5x between them. `lhci assert` re-reads this file after `lhci collect`, so the
// collected runs' Lighthouse benchmarkIndex picks the TBT baseline: below runner_class.slow_below
// a surface's `tbt_ms_slow` (with tolerance.tbt_ms_slow) applies, else `tbt_ms`. Before collect
// (no runs on disk) and for surfaces without tbt_ms_slow the class is irrelevant.
const LHCI_DIR = process.env.LHCI_RUNS_DIR || path.join(__dirname, ".lighthouseci");
function benchmarkIndexes() {
  let files = [];
  try {
    files = fs.readdirSync(LHCI_DIR).filter((f) => /^lhr-.*\.json$/.test(f));
  } catch {
    return {};
  }
  const bySurface = {};
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(LHCI_DIR, f), "utf8"));
    const p = new URL(r.requestedUrl).pathname.replace(/\/$/, "");
    const s = surfaces.find((x) => (target === "ci" ? x.ci_path : x.path).replace(/\/$/, "") === p);
    const bi = r.environment?.benchmarkIndex;
    if (s && Number.isFinite(bi)) (bySurface[s.id] ||= []).push(bi);
  }
  return bySurface;
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const collectedBi = benchmarkIndexes();
function runnerClass(surfaceId) {
  const xs = collectedBi[surfaceId];
  if (!xs?.length) return { class: null, benchmark_index: null };
  const bi = Math.round(median(xs));
  return {
    class: bi < (baselines.runner_class?.slow_below ?? 0) ? "slow" : "fast",
    benchmark_index: bi,
  };
}

function limitFor(surface, metric) {
  const budget = surface.budget[metric];
  const entry = baselines[target]?.[surface.id] ?? {};
  const slow =
    metric === "tbt_ms" && Number.isFinite(entry.tbt_ms_slow) && runnerClass(surface.id).class === "slow";
  const b = slow ? entry.tbt_ms_slow : entry[metric];
  const tolerance =
    (slow ? baselines.tolerance?.tbt_ms_slow : undefined) ?? baselines.tolerance?.[metric] ?? 0.1;
  if (!Number.isFinite(b) || b <= budget) return { error: budget, warn: null };
  const max = b * (1 + tolerance);
  return { error: metric === "cls" ? Number(max.toFixed(3)) : Math.round(max), warn: budget };
}

const errorMatrix = [];
const warnMatrix = [];
for (const surface of surfaces) {
  const errors = {};
  const warnings = {};
  for (const [metric, m] of Object.entries(METRICS)) {
    const { error, warn } = limitFor(surface, metric);
    // "median" = the median of the metric over the runs, as lhci-medians.mjs computes the baselines.
    // "median-run" asserted the metric of the run with median FCP/TTI, which in Design QA 43360989289
    // attempt 2 was the cold first booking run (TBT 1324 against a 595 median) (t_24fe7849).
    const opts = m.median ? { aggregationMethod: "median" } : {};
    const scale = m.scale ?? 1;
    errors[m.audit] = ["error", { maxNumericValue: error * scale, ...opts }];
    if (warn !== null) warnings[m.audit] = ["warn", { maxNumericValue: warn * scale, ...opts }];
  }
  const matchingUrlPattern = `^${escape(base + pathOf(surface))}/?(\\?.*)?$`;
  errorMatrix.push({ matchingUrlPattern, assertions: errors });
  if (Object.keys(warnings).length) warnMatrix.push({ matchingUrlPattern, assertions: warnings });
}
// CC-46: Lighthouse >= 90 on all four categories, mobile. Warn only: the UX.13.3 budgets above are the stricter line.
const categories = {
  "categories:performance": ["warn", { minScore: 0.9 }],
  "categories:accessibility": ["warn", { minScore: 0.9 }],
  "categories:best-practices": ["warn", { minScore: 0.9 }],
  "categories:seo": ["warn", { minScore: 0.9 }],
};

module.exports = {
  target,
  surfaces,
  runnerClass,
  limits: Object.fromEntries(surfaces.map((s) => [s.id, Object.fromEntries(Object.keys(METRICS).map((k) => [k, limitFor(s, k)]))])),
  ci: {
    collect: {
      url: surfaces.map((s) => `${base}${pathOf(s)}`),
      numberOfRuns: Number(process.env.LHCI_RUNS || 5),
      settings: {
        chromeFlags: "--no-sandbox --headless=new",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      },
    },
    assert: {
      assertMatrix: [...errorMatrix, ...warnMatrix, { matchingUrlPattern: ".*", assertions: categories }],
    },
    upload: { target: "filesystem", outputDir: process.env.LHCI_OUT_DIR || "out/lhci" },
  },
};
