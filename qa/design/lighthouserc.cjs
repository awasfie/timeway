// DESIGN-QA-CI (CC-56 as corrected by UX.13.10-2): UX.13.3 budgets per surface, Lighthouse
// default mobile profile (Moto G Power, simulated slow 4G), 5 runs, median. INP is field-only
// (web-vitals -> PostHog); the lab gate is TBT <= 200 ms.
// Ratchet (same rule as perf/lhci-baseline.json): while a surface's committed baseline is over
// its UX.13.3 budget, the error asserts baseline x (1 + tolerance) (a >10% regression fails, CC-56)
// and the budget itself drops to a warning. A surface without a baseline asserts the budget outright.
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

function limitFor(surface, metric) {
  const budget = surface.budget[metric];
  const b = baselines[target]?.[surface.id]?.[metric];
  const tolerance = baselines.tolerance?.[metric] ?? 0.1;
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
    const opts = m.median ? { aggregationMethod: "median-run" } : {};
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
