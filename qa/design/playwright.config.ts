import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.DESIGN_QA_BASE_URL || "https://timeway.co";

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: [["list"], ["html", { outputFolder: "out/report", open: "never" }]],
  outputDir: "out/results",
  // One baseline set per platform-independent name; CI (ubuntu) is the reference renderer.
  snapshotPathTemplate: "{testDir}/__screens__/{arg}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" } },
  use: { baseURL, ...devices["Desktop Chrome"], timezoneId: "Asia/Dubai" },
});
