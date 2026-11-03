#!/usr/bin/env node
// WC-TW-10a: submits templates.meta.json (EN + AR) to Meta on one WABA. Dry-run by default.
// Usage: WABA_ID=<id> WABA_TOKEN=<token> node submit-templates.mjs [--apply]
// Env names only; the token is read from the environment and never printed.
import { readFileSync } from "node:fs";

const GRAPH = "https://graph.facebook.com/v21.0";
const templates = JSON.parse(readFileSync(new URL("./templates.meta.json", import.meta.url), "utf8"));
const apply = process.argv.includes("--apply");
const { WABA_ID, WABA_TOKEN } = process.env;

if (!apply) {
  for (const t of templates) console.log(JSON.stringify({ dryRun: true, name: t.name, language: t.language, category: t.category }));
  process.exit(0);
}
if (!WABA_ID || !WABA_TOKEN) {
  console.error("WABA_ID and WABA_TOKEN are required with --apply");
  process.exit(2);
}

let failed = 0;
for (const t of templates) {
  const res = await fetch(`${GRAPH}/${WABA_ID}/message_templates`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${WABA_TOKEN}` },
    body: JSON.stringify(t),
  });
  const json = await res.json().catch(() => ({}));
  // Re-running is safe: Meta answers "already exists" for a name+language pair it has.
  const exists = /already exists/i.test(json?.error?.error_user_msg ?? json?.error?.message ?? "");
  if (!res.ok && !exists) failed++;
  console.log(JSON.stringify({ name: t.name, language: t.language, http: res.status, id: json.id ?? null, status: json.status ?? (exists ? "EXISTS" : null), error: res.ok || exists ? null : json?.error?.message ?? "unknown" }));
}
process.exit(failed ? 1 : 0);
