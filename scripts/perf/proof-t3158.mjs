// Temporary proof step (t_3158a373), only on throwaway proof branches; never merged.
// 1) HTML + inline RSC flight bytes for en and ar (Accept-Language) on the CI production build.
// 2) Arabic RTL screenshot of the booking page + date/slot view; records /api/i18n lazy loads.
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const url = process.env.BOOKING_URL;
const outDir = process.env.PROOF_OUT ?? "perf/out/proof";
mkdirSync(outDir, { recursive: true });

const size = (s) => {
  const buf = Buffer.from(s, "utf8");
  return { raw: buf.length, gz: gzipSync(buf, { level: 9 }).length };
};
const payload = (html) => {
  let flight = "";
  for (const m of html.matchAll(/<script\b[^>]*>(self\.__next_f\.push\([\s\S]*?)<\/script>/g)) flight += m[1];
  return { html: size(html), flight: size(flight) };
};

const result = { url, commit: process.env.GITHUB_SHA ?? null, locales: {} };
for (const lang of ["en", "ar"]) {
  const res = await fetch(url, { headers: { "user-agent": "timeway-perf-gate", "accept-language": lang } });
  const html = await res.text();
  const htmlTag = html.match(/<html\b[^>]*>/)?.[0] ?? "";
  result.locales[lang] = { status: res.status, html_tag: htmlTag, ...payload(html) };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: "ar", viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const i18nLoads = [];
const consoleErrors = [];
page.on("request", (r) => r.url().includes("/api/i18n/") && i18nLoads.push(r.url().replace(/^https?:\/\/[^/]+/, "")));
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 300)));
await page.goto(url, { waitUntil: "networkidle" });
await page.locator('[data-testid="day"][data-disabled="false"]').first().waitFor({ timeout: 60000 });
result.ar_dom = {
  dir: await page.evaluate(() => document.documentElement.dir),
  lang: await page.evaluate(() => document.documentElement.lang),
};
await page.screenshot({ path: `${outDir}/booking-ar-rtl.png` });
await page.locator('[data-testid="day"][data-disabled="false"]').first().click();
await page.locator('[data-testid="time"]').first().waitFor({ timeout: 60000 });
await page.waitForLoadState("networkidle");
await page.screenshot({ path: `${outDir}/booking-ar-rtl-slots.png` });
await page.locator('[data-testid="time"]').first().click();
await page.locator('[data-testid="confirm-book-button"]').waitFor({ timeout: 60000 });
await page.waitForLoadState("networkidle");
await page.screenshot({ path: `${outDir}/booking-ar-rtl-form.png` });
// A missing key renders as the raw snake_case key; flag any visible text that looks like one.
result.ar_raw_key_like = await page.evaluate(() =>
  [...document.body.innerText.matchAll(/\b[a-z]+(?:_[a-z0-9]+){1,}\b/g)].map((m) => m[0]).slice(0, 20)
);
result.ar_i18n_lazy_loads = i18nLoads;
result.ar_console_errors = consoleErrors.slice(0, 10);
await browser.close();

writeFileSync(`${outDir}/proof.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
const k = (b) => (b / 1024).toFixed(1);
const lines = ["### t_3158a373 proof: HTML / inline flight bytes", "", "| locale | status | HTML gz KB | HTML raw KB | flight gz KB | flight raw KB |", "| --- | --- | ---: | ---: | ---: | ---: |"];
for (const [l, v] of Object.entries(result.locales))
  lines.push(`| ${l} | ${v.status} | ${k(v.html.gz)} | ${k(v.html.raw)} | ${k(v.flight.gz)} | ${k(v.flight.raw)} |`);
lines.push("", `ar DOM dir=${result.ar_dom.dir} lang=${result.ar_dom.lang}; lazy i18n loads: ${i18nLoads.length}`);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n", { flag: "a" });
