#!/usr/bin/env node
// WC.2.5 slot API p95 source (WC-TW-6f): times the exact tRPC slots/getSchedule GET the public booker
// sends (2-month range: the viewed month + the prefetched next month, in the visitor's timezone).
// The booker calls same-origin /api/trpc on the HTTP/2 connection the page already opened, so the
// gated number is `warm` (one connection reused for every sample). `cold` (new TCP+TLS per sample)
// is recorded beside it because that is how WC-TW-6d first measured it (811 ms p95).
// Usage: node scripts/perf/slot-api.mjs [--origin https://timeway.co] [--user ahmedwasfie] [--slug 30min]
//          [--tz Asia/Dubai] [--month 2026-10] [--samples 30] [--budget-ms 800] [--enforce true]
//          [--out perf/out/slot-api.json]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), all[i + 1]]);
    return acc;
  }, [])
);
const origin = args.origin ?? "https://timeway.co";
const user = args.user ?? "ahmedwasfie";
const slug = args.slug ?? "30min";
const tz = args.tz ?? "Asia/Dubai";
const samples = Number(args.samples ?? 30);
const budgetMs = Number(args["budget-ms"] ?? 800);
const enforce = (args.enforce ?? "true") === "true";
const out = args.out ?? "perf/out/slot-api.json";

// Offset of `tz` at `date` in minutes east of UTC, via Intl (no date library needed in a CI script).
function tzOffsetMinutes(date) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName").value;
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

function localMidnightUtc(year, month0, day) {
  const guess = new Date(Date.UTC(year, month0, day));
  return new Date(guess.getTime() - tzOffsetMinutes(guess) * 60_000);
}

const now = new Date();
const [y, m] = (args.month ?? `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`).split("-").map(Number);
const startTime = localMidnightUtc(y, m - 1, 1).toISOString();
const endTime = new Date(localMidnightUtc(y, m + 1, 1).getTime() - 1).toISOString();

const input = {
  json: {
    isTeamEvent: false,
    usernameList: [user],
    eventTypeSlug: slug,
    startTime,
    endTime,
    timeZone: tz,
    duration: null,
    rescheduleUid: null,
    orgSlug: null,
    teamMemberEmail: null,
    routedTeamMemberIds: null,
    skipContactOwner: false,
    email: null,
    embedConnectVersion: "0",
    _isDryRun: false,
  },
  meta: {
    values: Object.fromEntries(
      ["duration", "orgSlug", "teamMemberEmail", "rescheduleUid", "routedTeamMemberIds", "email"].map((k) => [
        k,
        ["undefined"],
      ])
    ),
  },
};
const url = `${origin}/api/trpc/slots/getSchedule?input=${encodeURIComponent(JSON.stringify(input))}`;

const FMT =
  "%{http_code} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total} %{num_connects}\\n";

function curl(urls) {
  const argv = ["-s", "--http2"];
  for (const u of urls) argv.push("-o", "/dev/null", "-w", FMT, u);
  return execFileSync("curl", argv, { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => {
      const [status, connect, tls, ttfb, total, connects] = line.split(" ");
      return {
        status,
        handshake_ms: Math.round(Number(tls || connect) * 1000),
        ttfb_ms: Math.round(Number(ttfb) * 1000),
        total_ms: Math.round(Number(total) * 1000),
        new_connection: Number(connects) > 0,
      };
    });
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const summarise = (rows) => {
  const t = rows.map((r) => r.total_ms);
  return {
    n: rows.length,
    p50: pct(t, 50),
    p95: pct(t, 95),
    max: Math.max(...t),
    statuses: [...new Set(rows.map((r) => r.status))],
    total_ms: t,
  };
};

// The first warm request pays the handshake, as the page load already did in a browser; drop it.
const warmRows = curl(Array.from({ length: samples + 1 }, () => url)).slice(1);
const coldRows = Array.from({ length: samples }, () => curl([url])[0]);
const warm = summarise(warmRows);
const cold = summarise(coldRows);
const ok = warm.statuses.every((s) => s === "200") && warm.p95 < budgetMs;

const result = {
  measured_at: new Date().toISOString(),
  origin,
  event: `${user}/${slug}`,
  tz,
  range: { startTime, endTime },
  budget_ms: budgetMs,
  gated: "warm",
  warm: { ...warm, reused_connection: warmRows.every((r) => !r.new_connection) },
  cold: {
    ...cold,
    handshake_p50_ms: pct(
      coldRows.map((r) => r.handshake_ms),
      50
    ),
  },
  pass: ok,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  `slot API ${user}/${slug} ${startTime}..${endTime} ${tz}: warm p50 ${warm.p50} p95 ${warm.p95} max ${warm.max} ms; ` +
    `cold p50 ${cold.p50} p95 ${cold.p95} (handshake p50 ${result.cold.handshake_p50_ms}) ms; budget ${budgetMs}: ${ok ? "PASS" : "FAIL"}`
);
if (enforce && !ok) process.exit(1);
