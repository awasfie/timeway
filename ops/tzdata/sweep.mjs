#!/usr/bin/env node
// WC-TW-5a / CC-65: offset equivalence Node(ICU) vs Postgres for the zones Timeway serves.
//   node sweep.mjs zones                 print the zone list (one per line) for the SQL side
//   node sweep.mjs compare < pg.csv      pg.csv rows: zone,epoch_seconds,offset_minutes ; exit 1 on any diff
// Postgres produces the rows (tzdata-pin.yml); Node recomputes each offset with Intl and must agree on every row.
import { readFileSync } from "node:fs";

export const ZONES = [
  "Africa/Cairo",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Kuwait",
  "Asia/Qatar",
  "Asia/Bahrain",
  "Asia/Amman",
  "Asia/Beirut",
  "Africa/Casablanca",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "America/Toronto",
  "Australia/Sydney",
  "UTC",
];

const fmt = new Map();
function offsetMinutes(zone, epochSeconds) {
  let f = fmt.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" });
    fmt.set(zone, f);
  }
  const name = f.formatToParts(new Date(epochSeconds * 1000)).find((p) => p.type === "timeZoneName").value;
  if (name === "GMT") return 0;
  const m = /^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(name);
  if (!m) throw new Error(`unparseable offset ${name} for ${zone}`);
  const mins = Number(m[2]) * 60 + Number(m[3]) + Number(m[4] ?? 0) / 60;
  return m[1] === "-" ? -mins : mins;
}

const mode = process.argv[2];
if (mode === "zones") {
  console.log(ZONES.join("\n"));
} else if (mode === "compare") {
  const rows = readFileSync(0, "utf8").split("\n").filter(Boolean);
  const seenZones = new Set();
  const diffs = [];
  for (const row of rows) {
    const [zone, epoch, pgOff] = row.split(",");
    seenZones.add(zone);
    const nodeOff = offsetMinutes(zone, Number(epoch));
    if (nodeOff !== Number(pgOff)) diffs.push({ zone, utc: new Date(Number(epoch) * 1000).toISOString(), pg: Number(pgOff), node: nodeOff });
  }
  const missing = ZONES.filter((z) => !seenZones.has(z));
  console.log(`sweep: ${rows.length} rows, ${seenZones.size} zones, tz=${process.versions.tz}, ${diffs.length} diffs`);
  for (const d of diffs.slice(0, 50)) console.error(JSON.stringify(d));
  if (missing.length) console.error(`zones absent from Postgres output: ${missing.join(", ")}`);
  if (rows.length === 0 || diffs.length || missing.length) process.exit(1);
} else {
  console.error("usage: sweep.mjs zones | compare < pg.csv");
  process.exit(2);
}
