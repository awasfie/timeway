// WC-TW-6c gate (b). Lighthouse's default config is already the Moto G Power profile with
// simulated slow 4G (150 ms RTT, 1.6 Mbps), so no preset override is set on purpose.
// LHCI_URL is the booking page under test (PR build on the runner, or prod for scheduled runs).
const url = process.env.LHCI_URL || "http://localhost:3000/pro/30min";
// WC-TW-6c-10 region runs: LHCI_REGION=cairo|riyadh|dubai and LHCI_CITY_RTT_MS (measured by
// scripts/perf/region-rtt.mjs from that city) add the city's RTT to the slow-4G last mile, and the
// ratchet reads that region's baseline. A region without a committed baseline asserts the absolute
// thresholds (which today's page fails), so a missing baseline is red, never a silent pass.
const region = process.env.LHCI_REGION || "gh-runner";
const SLOW_4G_RTT_MS = 150;
const cityRtt = Number(process.env.LHCI_CITY_RTT_MS ?? 0);
if (region !== "gh-runner" && !(cityRtt > 0))
  throw new Error(`LHCI_REGION=${region} needs a measured LHCI_CITY_RTT_MS (got ${process.env.LHCI_CITY_RTT_MS})`);
const allBaselines = require("./lhci-baseline.json");
const baseline = (region === "gh-runner" ? allBaselines : allBaselines.regions?.[region]) ?? {};
module.exports.region = { region, city_rtt_ms: cityRtt, rtt_ms: SLOW_4G_RTT_MS + cityRtt };

// Ratchet: while main's median is over an absolute error threshold, the error asserts the committed
// baseline + tolerance (no regression) and the absolute threshold drops to a warning.
const ABSOLUTE = { lcp_ms: 2500, tbt_ms: 200 };
const limit = (key) => {
  const base = Number(baseline[key]);
  if (!Number.isFinite(base) || base <= ABSOLUTE[key]) return { max: ABSOLUTE[key], ratchet: false };
  const tolerance = Number(baseline.tolerance ?? allBaselines.tolerance ?? 0.1);
  return { max: Math.round(base * (1 + tolerance)), ratchet: true };
};
const lcp = limit("lcp_ms");
const tbt = limit("tbt_ms");
module.exports.limits = { lcp, tbt, absolute: ABSOLUTE };

const errors = {
  "largest-contentful-paint": ["error", { maxNumericValue: lcp.max, aggregationMethod: "median-run" }],
  // TBT is the lab proxy for INP (INP needs real interaction, which Lighthouse navigation mode lacks).
  "total-blocking-time": ["error", { maxNumericValue: tbt.max, aggregationMethod: "median-run" }],
};

const absoluteWarnings = {
  ...(lcp.ratchet && {
    "largest-contentful-paint": [
      "warn",
      { maxNumericValue: ABSOLUTE.lcp_ms, aggregationMethod: "median-run" },
    ],
  }),
  ...(tbt.ratchet && {
    "total-blocking-time": ["warn", { maxNumericValue: ABSOLUTE.tbt_ms, aggregationMethod: "median-run" }],
  }),
};

const warnings = {
  "largest-contentful-paint": ["warn", { maxNumericValue: 1500, aggregationMethod: "median-run" }],
  // On a GitHub runner TTFB says nothing about the Middle East; the region job owns that gate.
  "server-response-time": ["warn", { maxNumericValue: 500, aggregationMethod: "median-run" }],
};

module.exports.ci = {
  collect: {
    url: [url],
    numberOfRuns: 3,
    settings: {
      chromeFlags: "--no-sandbox --headless=new",
      onlyCategories: ["performance"],
      ...(region !== "gh-runner" && {
        throttling: {
          rttMs: SLOW_4G_RTT_MS + cityRtt,
          throughputKbps: 1638.4,
          cpuSlowdownMultiplier: 4,
        },
      }),
    },
  },
  assert: {
    assertMatrix: [
      { matchingUrlPattern: ".*", assertions: errors },
      { matchingUrlPattern: ".*", assertions: absoluteWarnings },
      { matchingUrlPattern: ".*", assertions: warnings },
    ],
  },
  upload: {
    target: "filesystem",
    outputDir: process.env.LHCI_OUT_DIR || "perf/out/lhci",
  },
};
