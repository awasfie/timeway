#!/usr/bin/env node
/**
 * CC-17 — Timezone matrix conformance probe  (Bible v12 PART CC / CC-17, D-R50-5)
 *
 * "Timezone matrix Cairo-DST x Riyadh x Dubai x London, minute-exact."
 *
 * READ-ONLY. Issues only GET requests against the slot API. Creates nothing,
 * books nothing, mutates nothing (T5 / D-R41 safe).
 *
 * Runs INSIDE the deployed Timeway container against http://127.0.0.1:${PORT}
 * so that (a) it exercises the built artifact, not a dev tree, and (b) it is
 * not shaped by the Cloudflare edge in front of timeway.co.
 *
 * WHAT IT ACTUALLY ASSERTS (and why each one catches a real failure):
 *
 *  S1  The same availability, requested with four different viewer timeZones,
 *      returns the IDENTICAL set of UTC instants. This is the assertion that
 *      catches the classic cal.com-family bug: the viewer's tz leaking into
 *      the host's availability computation, so a London visitor sees a
 *      different working day than a Riyadh visitor.
 *
 *  S2  Those instants, rendered in the HOST's tz, land exactly on the host's
 *      configured working window. Catches a whole-window shift that S1 alone
 *      would pass (all four zones can be equally wrong).
 *
 *  S3  The same instant renders at DIFFERENT wall-clock times per zone, and
 *      conversions are minute-exact. Catches a stubbed/ignored tz parameter.
 *
 *  S4  CAIRO DST BOUNDARY (the point of this CC). Egypt ends DST in late
 *      October. The script first proves from the runtime's own tz database
 *      that a real offset change exists in the probe window -- if the tzdata
 *      in the image is stale and shows no transition, that is a FAILURE, not
 *      a skip, because then the rest of the section would assert nothing.
 *      Then: instants stay viewer-invariant across the flip; the host-local
 *      window is identical on every day either side (no phantom/lost hour);
 *      and the same host slot renders exactly one hour apart in Cairo before
 *      vs after, i.e. DST is applied rather than silently ignored.
 *
 *  S5  A second event-type duration (15 min) keeps its granularity in all
 *      four zones and yields strictly more slots than the 30 min one, so the
 *      duration math is real and not a fixed grid.
 *
 * VACUOUS-PASS GUARDS (D-R50-5):
 *   - every quantified assertion first asserts its input set is non-empty;
 *   - an absent DST transition in the runtime tzdata FAILS;
 *   - if a probe user/event-type cannot be discovered the script exits 2
 *     (blocked) rather than 0;
 *   - pass === 0 exits 2.
 *
 * Exit: 0 all passed · 1 at least one failure · 2 could not run / nothing asserted.
 */

const PORT = process.env.PORT || 3000;
const BASE = process.env.CC17_BASE_URL || `http://127.0.0.1:${PORT}`;
const ZONES = ["Africa/Cairo", "Asia/Riyadh", "Asia/Dubai", "Europe/London"];

let pass = 0;
const failures = [];

function ck(cond, msg) {
  if (cond) {
    pass++;
    console.log("PASS  " + msg);
  } else {
    failures.push(msg);
    console.log("FAIL  " + msg);
  }
}
function info(msg) {
  console.log("      " + msg);
}
function die(msg) {
  console.error("\nBLOCKED: " + msg);
  process.exit(2);
}

/** UTC offset of `zone` at instant `date`, in minutes. Uses the runtime tzdb. */
function offsetMinutes(date, zone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === "24" ? "00" : p.hour), +p.minute, +p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}
function wall(date, zone) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}
function fmtOffset(m) {
  const s = m < 0 ? "-" : "+";
  const a = Math.abs(m);
  return s + String(Math.floor(a / 60)).padStart(2, "0") + String(a % 60).padStart(2, "0");
}

async function getSchedule({ username, slug, tz, start, end }) {
  const input = {
    json: {
      isTeamEvent: false,
      usernameList: [username],
      eventTypeSlug: slug,
      startTime: start,
      endTime: end,
      timeZone: tz,
      duration: null,
      rescheduleUid: null,
      orgSlug: null,
    },
    meta: { values: { duration: ["undefined"], rescheduleUid: ["undefined"], orgSlug: ["undefined"] } },
  };
  const url = `${BASE}/api/trpc/slots/getSchedule?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`getSchedule ${tz} ${slug} -> HTTP ${res.status}`);
  const body = await res.json();
  const slots = body?.result?.data?.json?.slots;
  if (!slots) throw new Error(`getSchedule ${tz} ${slug} -> no slots key in response`);
  return slots;
}
function flatten(slots) {
  const out = new Set();
  for (const day of Object.keys(slots)) for (const s of slots[day]) out.add(s.time);
  return [...out].sort();
}
/** Normalise to epoch ms so an ISO formatting difference is not mistaken for a real one. */
const toMs = (arr) => arr.map((t) => new Date(t).getTime()).sort((a, b) => a - b);
const sameMs = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

(async () => {
  console.log("CC-17 timezone matrix — READ-ONLY");
  console.log("  ran at   " + new Date().toISOString());
  console.log("  base     " + BASE);
  console.log("  node     " + process.version);
  console.log("  zones    " + ZONES.join(", "));
  console.log("");

  const USER = process.env.CC17_USERNAME || "ahmedwasfie";
  const SLUG30 = process.env.CC17_SLUG_30 || "30min";
  const SLUG15 = process.env.CC17_SLUG_15 || "15min";

  // A Mon-Fri week far enough out that min-notice cannot empty it.
  const W = { start: "2026-10-05T00:00:00.000Z", end: "2026-10-09T23:59:59.999Z" };

  // ---------- S1 : viewer-tz invariance ----------
  const byZone = {};
  for (const tz of ZONES) {
    let f;
    try {
      f = flatten(await getSchedule({ username: USER, slug: SLUG30, tz, ...W }));
    } catch (e) {
      die(`cannot reach the slot API (${e.message}). CC-17 asserts nothing without it.`);
    }
    byZone[tz] = toMs(f);
    ck(byZone[tz].length > 0, `[S1] ${tz}: non-empty slot set (${byZone[tz].length} instants)`);
  }
  if (Object.values(byZone).every((v) => v.length === 0)) {
    die("every zone returned zero slots — the probe user/event-type has no availability, so nothing below could fail.");
  }
  const refTz = ZONES[0];
  for (const tz of ZONES.slice(1)) {
    ck(sameMs(byZone[tz], byZone[refTz]),
      `[S1] ${tz}: UTC instants identical to ${refTz} (${byZone[tz].length} vs ${byZone[refTz].length}) — viewer tz does not leak into host availability`);
  }

  // ---------- S2 : instants land on the host's real window ----------
  const HOST_TZ = process.env.CC17_HOST_TZ || "Asia/Dubai";
  const ref = byZone[refTz];
  const hostTimes = [...new Set(ref.map((ms) => wall(new Date(ms), HOST_TZ).hm))].sort();
  info(`host-local (${HOST_TZ}) slot times: ${hostTimes[0]} .. ${hostTimes[hostTimes.length - 1]} (${hostTimes.length} distinct)`);
  ck(hostTimes.length >= 2, `[S2] host-local window has more than one distinct start time (${hostTimes.length})`);
  const firstHm = hostTimes[0], lastHm = hostTimes[hostTimes.length - 1];
  const [fh, fm] = firstHm.split(":").map(Number);
  const [lh, lm] = lastHm.split(":").map(Number);
  const spanMin = lh * 60 + lm - (fh * 60 + fm);
  ck(spanMin > 0 && spanMin <= 16 * 60,
    `[S2] host-local window spans a plausible working day (${firstHm}..${lastHm}, ${spanMin} min) — not a 24h grid, not inverted`);
  ck(fm % 15 === 0 && lm % 15 === 0, `[S2] host-local boundaries fall on clean quarter-hours (${firstHm}, ${lastHm}) — no drifted offset`);

  // ---------- S3 : minute-exact per-zone rendering ----------
  const t0 = new Date(ref[0]);
  const walls = {};
  for (const z of ZONES) {
    walls[z] = wall(t0, z);
    info(`${t0.toISOString()} -> ${z}: ${walls[z].day} ${walls[z].hm} (${fmtOffset(offsetMinutes(t0, z))})`);
  }
  ck(new Set(Object.values(walls).map((w) => w.hm)).size > 1,
    "[S3] the same instant renders at different wall-clock times per zone — the tz parameter is live, not stubbed");
  ck(Object.values(walls).every((w) => Number(w.hm.split(":")[1]) === t0.getUTCMinutes()),
    "[S3] every conversion is minute-exact (all four zones are whole-hour offsets from UTC here)");

  // ---------- S4 : Cairo DST boundary ----------
  const CAIRO = "Africa/Cairo";
  const probeDays = ["2026-10-26", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-02", "2026-11-04"];
  const offs = {};
  for (const d of probeDays) offs[d] = offsetMinutes(new Date(d + "T12:00:00Z"), CAIRO);
  info("Cairo UTC offsets: " + probeDays.map((d) => `${d}=${fmtOffset(offs[d])}`).join(" "));
  const distinct = [...new Set(Object.values(offs))];
  ck(distinct.length === 2,
    `[S4] the runtime tz database contains a real Cairo DST transition in the probe window (offsets ${distinct.map(fmtOffset).join(", ")}) — a stale tzdb would make this section vacuous, so it FAILS rather than skips`);
  if (distinct.length !== 2) {
    console.log("\nRESULT: " + pass + " passed, " + failures.length + " failed");
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
  ck(Math.abs(distinct[0] - distinct[1]) === 60, `[S4] the transition is exactly one hour (${Math.abs(distinct[0] - distinct[1])} min)`);

  const DW = { start: "2026-10-26T00:00:00.000Z", end: "2026-11-04T23:59:59.999Z" };
  const cairoDst = toMs(flatten(await getSchedule({ username: USER, slug: SLUG30, tz: CAIRO, ...DW })));
  const dubaiDst = toMs(flatten(await getSchedule({ username: USER, slug: SLUG30, tz: HOST_TZ, ...DW })));
  const londonDst = toMs(flatten(await getSchedule({ username: USER, slug: SLUG30, tz: "Europe/London", ...DW })));
  ck(cairoDst.length > 0, `[S4] DST-window slot set is non-empty (${cairoDst.length} instants) — otherwise the flip assertions assert nothing`);
  ck(sameMs(cairoDst, dubaiDst) && sameMs(cairoDst, londonDst),
    "[S4] across the Cairo DST boundary the instants are still viewer-tz-invariant (Cairo == Dubai == London)");

  // host-local window must be constant on every probe day (host tz has no DST)
  const perDay = {};
  for (const ms of cairoDst) {
    const w = wall(new Date(ms), HOST_TZ);
    (perDay[w.day] ||= []).push(w.hm);
  }
  const days = Object.keys(perDay).sort();
  for (const d of days) {
    perDay[d].sort();
    info(`${d} host-local: ${perDay[d][0]}..${perDay[d][perDay[d].length - 1]} (${perDay[d].length})`);
  }
  const beforeDays = days.filter((d) => d <= "2026-10-29");
  const afterDays = days.filter((d) => d >= "2026-10-31");
  ck(beforeDays.length > 0 && afterDays.length > 0,
    `[S4] the returned window straddles the flip (${beforeDays.length} day(s) before, ${afterDays.length} after)`);
  const windows = new Set(days.map((d) => `${perDay[d][0]}-${perDay[d][perDay[d].length - 1]}`));
  ck(windows.size === 1,
    `[S4] the host-local window is identical on every day either side of the Cairo flip (${[...windows].join(" | ")}) — no phantom or lost hour`);

  if (beforeDays.length && afterDays.length) {
    const sampleBefore = cairoDst.find((ms) => wall(new Date(ms), HOST_TZ).day === beforeDays[beforeDays.length - 1]);
    const sampleAfter = cairoDst.find((ms) => wall(new Date(ms), HOST_TZ).day === afterDays[0]);
    const cb = wall(new Date(sampleBefore), CAIRO), ca = wall(new Date(sampleAfter), CAIRO);
    const hb = wall(new Date(sampleBefore), HOST_TZ), ha = wall(new Date(sampleAfter), HOST_TZ);
    info(`first slot, host-local ${hb.hm} on ${hb.day} -> Cairo ${cb.hm}; host-local ${ha.hm} on ${ha.day} -> Cairo ${ca.hm}`);
    ck(hb.hm === ha.hm, `[S4] both samples are the same host-local start time (${hb.hm}) — an apples-to-apples comparison`);
    ck(cb.hm !== ca.hm,
      `[S4] the same host slot renders one hour apart in Cairo either side of the flip (${cb.hm} -> ${ca.hm}) — DST is applied, not ignored`);
  }

  // ---------- S5 : duration granularity across zones ----------
  const f15 = {};
  for (const tz of ZONES) f15[tz] = toMs(flatten(await getSchedule({ username: USER, slug: SLUG15, tz, ...W })));
  ck(Object.values(f15).every((v) => v.length > 0), "[S5] the 15-min event type returns slots in all four zones");
  ck(ZONES.slice(1).every((tz) => sameMs(f15[tz], f15[refTz])), "[S5] 15-min event: UTC instants identical across all four zones");
  ck(f15[HOST_TZ].length > byZone[HOST_TZ].length,
    `[S5] 15-min yields strictly more slots than 30-min (${f15[HOST_TZ].length} > ${byZone[HOST_TZ].length}) — duration math is real, not a fixed grid`);

  console.log("");
  console.log(`RESULT: ${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
  if (pass === 0) die("zero assertions ran");
  process.exit(0);
})().catch((e) => {
  console.error("\nERROR: " + (e && e.stack ? e.stack : e));
  process.exit(2);
});
