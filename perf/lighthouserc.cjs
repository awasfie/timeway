// WC-TW-6c gate (b). Lighthouse's default config is already the Moto G Power profile with
// simulated slow 4G (150 ms RTT, 1.6 Mbps), so no preset override is set on purpose.
// LHCI_URL is the booking page under test (PR build on the runner, or prod for scheduled runs).
const url = process.env.LHCI_URL || "http://localhost:3000/pro/30min";

const errors = {
  "largest-contentful-paint": ["error", { maxNumericValue: 2500, aggregationMethod: "median-run" }],
  // TBT is the lab proxy for INP (INP needs real interaction, which Lighthouse navigation mode lacks).
  "total-blocking-time": ["error", { maxNumericValue: 200, aggregationMethod: "median-run" }],
};

const warnings = {
  "largest-contentful-paint": ["warn", { maxNumericValue: 1500, aggregationMethod: "median-run" }],
  // On a GitHub runner TTFB says nothing about the Middle East; the region job owns that gate.
  "server-response-time": ["warn", { maxNumericValue: 500, aggregationMethod: "median-run" }],
};

module.exports = {
  ci: {
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
        { matchingUrlPattern: ".*", assertions: warnings },
      ],
    },
    upload: {
      target: "filesystem",
      outputDir: process.env.LHCI_OUT_DIR || "perf/out/lhci",
    },
  },
};
