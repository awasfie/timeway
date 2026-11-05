// Prints and writes the per-surface medians of the collected Lighthouse runs (the numbers a
// baseline in lhci-baseline.json is built from). Usage: node lhci-medians.mjs <lhci dir> <out.json>
import fs from "node:fs";
import path from "node:path";

const [dir = ".lighthouseci", out = "out/lhci-medians.json"] = process.argv.slice(2);
const { surfaces, target } = await import("./lighthouserc.cjs").then((m) => m.default);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const runs = fs
  .readdirSync(dir)
  .filter((f) => /^lhr-.*\.json$/.test(f))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
const result = {};
for (const s of surfaces) {
  const p = target === "ci" ? s.ci_path : s.path;
  const mine = runs.filter((r) => new URL(r.requestedUrl).pathname.replace(/\/$/, "") === p.replace(/\/$/, ""));
  const scriptKb = (r) => (r.audits["resource-summary"]?.details?.items ?? []).find((i) => i.resourceType === "script")?.transferSize / 1024;
  result[s.id] = {
    runs: mine.length,
    lcp_ms: Math.round(median(mine.map((r) => r.audits["largest-contentful-paint"].numericValue))),
    tbt_ms: Math.round(median(mine.map((r) => r.audits["total-blocking-time"].numericValue))),
    cls: Number(median(mine.map((r) => r.audits["cumulative-layout-shift"].numericValue)).toFixed(3)),
    js_kb: Math.round(median(mine.map(scriptKb))),
    budget: s.budget,
  };
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ target, medians: result }, null, 2));
console.log(JSON.stringify({ target, medians: result }));
