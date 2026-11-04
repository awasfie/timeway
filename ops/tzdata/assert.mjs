#!/usr/bin/env node
// WC-TW-5a / CC-65: Node/ICU tzdata and image OS tzdata must both equal the pin in pin.env.
//   node assert.mjs [--pg <version-line>]   exit 0 equal, 1 mismatch
// --pg takes Postgres's tzdata.zi first line (see tzdata-pin.yml) so all three are judged in one place.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pin = /^TZ_VERSION=(\S+)$/m.exec(readFileSync(join(here, "pin.env"), "utf8"))?.[1];
if (!pin) {
  console.error("pin.env has no TZ_VERSION");
  process.exit(1);
}

const versionOf = (line) => /^# version (\S+)/.exec(line.trim())?.[1] ?? `unreadable(${line.trim()})`;
const osFile = process.env.TZDATA_ZI ?? "/usr/share/zoneinfo/tzdata.zi";
let os;
try {
  os = versionOf(readFileSync(osFile, "utf8").split("\n", 1)[0]);
} catch (e) {
  os = `missing(${osFile})`;
}

const seen = { pin, node: process.versions.tz, os };
const pgIdx = process.argv.indexOf("--pg");
if (pgIdx > -1) seen.postgres = versionOf(process.argv[pgIdx + 1] ?? "");

const bad = Object.entries(seen).filter(([, v]) => v !== pin);
console.log(JSON.stringify({ ...seen, icu: process.versions.icu, icuTzDir: process.env.ICU_TIMEZONE_FILES_DIR ?? null }));
if (bad.length) {
  console.error(`tzdata mismatch vs pin ${pin}: ${bad.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  process.exit(1);
}
console.log(`tzdata OK: all equal ${pin}`);
