// node --test scripts/i18n/check-ar-en-parity.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkParity, failed, placeholders, tags } from "./check-ar-en-parity.mjs";

const en = {
  greet: "Hello {{name}}",
  link: "Read <0>the docs</0>",
  brand: "Zoom",
  nested: { a: "Busy", b: "{{count}} items" },
};

test("clean fixture passes; identical values are warnings only", () => {
  const ar = {
    greet: "مرحبا {{name}}",
    link: "اقرأ <0>الوثائق</0>",
    brand: "Zoom",
    nested: { a: "مشغول", b: "{{count}} عناصر" },
  };
  const r = checkParity(en, ar);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.placeholderMismatches, []);
  assert.deepEqual(r.tagMismatches, []);
  assert.deepEqual(r.identical, ["brand"]);
  assert.equal(failed(r), false);
});

test("missing top-level and nested keys fail", () => {
  const r = checkParity(en, { greet: "مرحبا {{name}}", link: "اقرأ <0>الوثائق</0>", nested: { a: "مشغول" } });
  assert.deepEqual(r.missing, ["brand", "nested.b"]);
  assert.equal(failed(r), true);
});

test("placeholder and tag drift fail", () => {
  const r = checkParity(en, {
    greet: "مرحبا {{user}}",
    link: "اقرأ الوثائق",
    brand: "زووم",
    nested: { a: "مشغول", b: "{{count}} عناصر" },
  });
  assert.deepEqual(
    r.placeholderMismatches.map((m) => m.key),
    ["greet"]
  );
  assert.deepEqual(
    r.tagMismatches.map((m) => m.key),
    ["link"]
  );
  assert.equal(failed(r), true);
});

test("extractors ignore formatter args and whitespace", () => {
  assert.deepEqual(placeholders("{{amount, currency}} for {{ name }}"), ["amount", "name"]);
  assert.deepEqual(tags("<0>a</0> <br/>"), ["</0>", "<0>", "<br/>"]);
});

test("CLI exits 1 on a broken locale dir and 0 on a clean one", () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-ar-en-parity.mjs");
  const mk = (arJson) => {
    const dir = mkdtempSync(path.join(tmpdir(), "parity-"));
    for (const [loc, json] of [
      ["en", en],
      ["ar", arJson],
    ]) {
      mkdirSync(path.join(dir, loc));
      writeFileSync(path.join(dir, loc, "common.json"), JSON.stringify(json));
    }
    return dir;
  };
  const good = mk({
    greet: "مرحبا {{name}}",
    link: "اقرأ <0>الوثائق</0>",
    brand: "Zoom",
    nested: { a: "مشغول", b: "{{count}} عناصر" },
  });
  assert.match(
    execFileSync("node", [script, good], { encoding: "utf8" }),
    /^0 missing, 0 placeholder mismatches, 0 tag mismatches/m
  );
  const bad = mk({ greet: "مرحبا" });
  assert.throws(
    () => execFileSync("node", [script, bad], { stdio: "pipe" }),
    (e) => e.status === 1
  );
});
