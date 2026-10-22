// WC-TW-6c gate (b). Lighthouse's default config is already the Moto G Power profile with
// simulated slow 4G (150 ms RTT, 1.6 Mbps), so no preset override is set on purpose.
// LHCI_URL is the booking page under test (PR build on the runner, or prod for scheduled runs).
const url = process.env.LHCI_URL || "http://localhost:3000/pro/30min";
const baseline = require("./lhci-baseline.json");

// Ratchet: while main's median is over an absolute error threshold, the error asserts the committed
// baseline + tolerance (no regression) and the absolute threshold drops to a warning.
const ABSOLUTE = { lcp_ms: 2500, tbt_ms: 200 };
const limit = (key) => {
  const base = Number(baseline[key]);
  if (!Number.isFinite(base) || base <= ABSOLUTE[key]) return { max: ABSOLUTE[key], ratchet: false };
  return { max: Math.round(base * (1 + Number(baseline.tolerance ?? 0.1))), ratchet: true };
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
