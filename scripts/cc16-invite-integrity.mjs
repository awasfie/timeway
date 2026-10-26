#!/usr/bin/env node
/**
 * CC-16 — Invite integrity (Bible PART CC / CC-16): ICS validates + imports,
 * video URL resolves, reschedule/cancel links work.
 * READ-ONLY (GET only). Usage: node scripts/cc16-invite-integrity.mjs <booking-uid>... [--base=https://timeway.co]
 * Exit: 0 all passed · 1 failure · 2 nothing asserted.
 */
const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith("--base=")) || "--base=https://timeway.co").slice(7).replace(/\/$/, "");
const uids = args.filter((a) => !a.startsWith("--"));
let pass = 0;
const fails = [];
const ck = (c, m) => (c ? (pass++, console.log("PASS", m)) : (fails.push(m), console.log("FAIL", m)));
const get = (u) => fetch(u, { redirect: "follow" });
if (!uids.length) { console.log("no uids"); process.exit(2); }

for (const uid of uids) {
  const tag = `[${uid}]`;
  const r = await get(`${BASE}/api/ics/${uid}`);
  const ics = await r.text();
  ck(r.status === 200 && /^text\/calendar/.test(r.headers.get("content-type") || ""), `${tag} ics 200 text/calendar (${r.status})`);
  const unf = ics.replace(/\r\n[ \t]/g, "");
  const lines = unf.split("\r\n").filter(Boolean);
  ck(lines[0] === "BEGIN:VCALENDAR" && lines.at(-1) === "END:VCALENDAR" && lines.includes("BEGIN:VEVENT") && lines.includes("END:VEVENT"), `${tag} ics BEGIN/END structure`);
  const f = (k) => (lines.find((l) => l.startsWith(k + ":") || l.startsWith(k + ";")) || "").replace(/^[^:]*:/, "");
  ck(f("UID") === `${uid}@Timeway`, `${tag} ics UID == ${uid}@Timeway`);
  const ds = f("DTSTART"), de = f("DTEND");
  ck(/^\d{8}T\d{6}Z$/.test(ds) && /^\d{8}T\d{6}Z$/.test(de) && de > ds, `${tag} ics DTSTART<DTEND UTC (${ds}..${de})`);
  ck(/^mailto:/.test(f("ORGANIZER").replace(/^.*?(mailto:)/, "$1")) && lines.some((l) => l.startsWith("ATTENDEE")), `${tag} ics organizer + attendee`);
  const loc = f("LOCATION");
  ck(/^https:\/\//.test(loc), `${tag} ics LOCATION is a https video URL (got "${loc}")`);
  if (/^https:\/\//.test(loc)) { const v = await get(loc); ck(v.status === 200, `${tag} video URL resolves (${v.status})`); }
  const m = unf.match(/https:\/\/[^\s\\]*\/booking\/[^\s\\]+changes=true/);
  ck(!!m, `${tag} ics carries reschedule/cancel link`);
  const pg = await get(`${BASE}/booking/${uid}`); ck(pg.status === 200, `${tag} booking page 200 (${pg.status})`);
  const cn = await get(`${BASE}/booking/${uid}?cancel=true`); ck(cn.status === 200, `${tag} cancel link 200 (${cn.status})`);
  const rs = await get(`${BASE}/reschedule/${uid}`); ck(rs.status === 200 && /rescheduleUid=/.test(rs.url), `${tag} reschedule link lands on booker (${rs.status} ${new URL(rs.url).pathname})`);
}
console.log(`RESULT: ${fails.length ? "FAIL" : pass ? "PASS" : "NONE"} pass=${pass} fail=${fails.length}`);
process.exit(fails.length ? 1 : pass ? 0 : 2);
