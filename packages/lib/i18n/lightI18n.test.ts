import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";

import { createLightI18n } from "./lightI18n";

// WC-TW-6n-4b: the booker's client translator must match i18next for every string the app ships.
const LOCALES_DIR = path.resolve(__dirname, "../../i18n/locales");
const locales = readdirSync(LOCALES_DIR).filter((l) => {
  try {
    readFileSync(path.join(LOCALES_DIR, l, "common.json"));
    return true;
  } catch {
    return false;
  }
});
const en = JSON.parse(readFileSync(path.join(LOCALES_DIR, "en", "common.json"), "utf8"));

const VARS = {
  name: "Ada <b>&",
  count: 3,
  user: "u'1",
  date: "2026-11-05",
  time: "10:00",
  eventName: "Intro/30",
  amount: 12.5,
  duration: 30,
  attendeeName: "Bob",
  organizerName: "Cy",
  email: "a@b.co",
  appName: "Timeway",
};

function reference(locale: string, resources: Record<string, unknown>) {
  const i = createInstance();
  i.init({ lng: locale, resources: { [locale]: { common: resources } } });
  return i.getFixedT(locale, "common");
}

describe("createLightI18n matches i18next", () => {
  it.each(locales)("%s: every key, with and without values", (locale) => {
    const resources = {
      ...en,
      ...JSON.parse(readFileSync(path.join(LOCALES_DIR, locale, "common.json"), "utf8")),
    };
    const ref = reference(locale, resources);
    const { t } = createLightI18n(locale, "common", resources);
    const bases = new Set(Object.keys(resources).map((k) => k.replace(/_(zero|one|two|few|many|other)$/, "")));
    const mismatches: string[] = [];
    for (const k of Array.from(bases)) {
      for (const opts of [undefined, VARS, { ...VARS, count: 0 }, { ...VARS, count: 1 }, { count: 7 }]) {
        const a = ref(k, opts as never);
        const b = t(k, opts as never);
        if (a !== b) mismatches.push(`${k} ${JSON.stringify(opts)}: ${a} !== ${b}`);
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
  });

  it("edge cases", () => {
    const res = {
      hi: "Hi {{name}}",
      raw: "Hi {{- name}}",
      nested: "$t(hi) and $t(item, {\"count\": 2})",
      item_one: "{{count}} item",
      item_other: "{{count}} items",
      item_zero: "no items",
      price: "{{v, currency(USD)}}",
      num: "{{v, number}}",
      ctx: "base",
      ctx_male: "he",
      obj: { a: "A {{name}}", b: "B" },
      "dot.key": "flat dotted",
    };
    const ref = reference("en", res);
    const { t, i18n } = createLightI18n("en", "common", res);
    const cases: [unknown, unknown][] = [
      ["hi", { name: "<x>" }],
      ["raw", { name: "<x>" }],
      ["hi", { name: "x", interpolation: { escapeValue: false } }],
      ["nested", { name: "N" }],
      ["item", { count: 0 }],
      ["item", { count: 1 }],
      ["item", { count: 5 }],
      ["price", { v: 9.5 }],
      ["num", { v: 12345.6 }],
      ["ctx", { context: "male" }],
      ["ctx", { context: "female" }],
      ["missing_key", undefined],
      ["missing_key", { defaultValue: "dflt {{name}}", name: "z" }],
      ["missing_key", "plain default"],
      [["missing_key", "hi"], { name: "arr" }],
      ["common:hi", { name: "ns" }],
      ["obj", { returnObjects: true, name: "o" }],
      ["dot.key", undefined],
      ["hi", undefined],
    ];
    for (const [k, o] of cases) expect(t(k as never, o as never)).toEqual(ref(k as never, o as never));
    expect(i18n.exists("hi")).toBe(true);
    expect(i18n.exists("nope")).toBe(false);
    expect(i18n.language).toBe("en");
    expect(i18n.dir()).toBe("ltr");
    expect(createLightI18n("ar", "common", {}).i18n.dir()).toBe("rtl");
  });
});
