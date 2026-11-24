import type { TFunction, i18n as I18nInstance } from "i18next";

/**
 * WC-TW-6n-4b: a dependency-free translator for strings the server already resolved.
 *
 * The App Router root layout passes the merged `common` namespace for the request locale through
 * AppRouterI18nContext. Running a full i18next instance on the client only to look those strings up
 * put i18next (13.7 KB gz) and react-i18next on the public booker's first load. This module
 * reproduces the i18next 23 behaviour the app relies on (flat keys, `{{var}}` / `{{- var}}`
 * interpolation with HTML escaping, `{{x, currency}}`-style Intl formats, `_one/_other/_zero`
 * plurals, `_context` keys, `$t(key)` / `$t(key, {...})` nesting, defaultValue, key arrays,
 * returnObjects) and is checked against i18next itself in lightI18n.test.ts on every locale file.
 */

type Resources = Record<string, unknown>;
type TOptions = Record<string, unknown> & {
  count?: unknown;
  context?: unknown;
  defaultValue?: unknown;
  replace?: unknown;
  returnObjects?: boolean;
  ordinal?: boolean;
  lng?: string;
  interpolation?: { escapeValue?: boolean; skipOnVariables?: boolean };
  formatParams?: Record<string, Record<string, unknown>>;
  nest?: boolean;
};

const ENTITY: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "/": "&#x2F;",
};
const escapeHtml = (v: unknown) => (typeof v === "string" ? v.replace(/[&<>"'/]/g, (s) => ENTITY[s]) : v);
const makeString = (v: unknown) => (v == null ? "" : `${v}`);
const regexSafe = (v: string) => v.replace(/\$/g, "$$$$");
const SUFFIX_ORDER: Record<string, number> = { zero: 0, one: 1, two: 2, few: 3, many: 4, other: 5 };

function deepFind(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  if (o[path]) return o[path];
  const parts = path.split(".");
  let current: unknown = o;
  for (let i = 0; i < parts.length; i++) {
    if (!current || typeof current !== "object") return undefined;
    const c = current as Record<string, unknown>;
    if (typeof c[parts[i]] === "string" && i + 1 < parts.length) return undefined;
    if (c[parts[i]] === undefined) {
      // i18next also tries joined segments ("a.b" as one key) before giving up
      let j = 2;
      let mix = c[parts.slice(i, i + j).join(".")];
      while (mix === undefined && parts.length > i + j) {
        j++;
        mix = c[parts.slice(i, i + j).join(".")];
      }
      if (mix === undefined) return undefined;
      if (mix === null) return null;
      if (path.endsWith(parts.slice(i, i + j).join("."))) return typeof mix === "string" ? mix : undefined;
      return deepFind(mix, parts.slice(i + j).join("."));
    }
    current = c[parts[i]];
  }
  return current;
}

function parseFormat(formatStr: string) {
  let formatName = formatStr.toLowerCase().trim();
  const formatOptions: Record<string, unknown> = {};
  if (formatStr.indexOf("(") > -1) {
    const p = formatStr.split("(");
    formatName = p[0].toLowerCase().trim();
    const optStr = p[1].substring(0, p[1].length - 1);
    if (formatName === "currency" && optStr.indexOf(":") < 0) {
      formatOptions.currency = optStr.trim();
    } else if (formatName === "relativetime" && optStr.indexOf(":") < 0) {
      formatOptions.range = optStr.trim();
    } else {
      optStr.split(";").forEach((opt) => {
        if (!opt) return;
        const [k, ...rest] = opt.split(":");
        const val = rest.join(":").trim().replace(/^'+|'+$/g, "");
        const key = k.trim();
        if (!formatOptions[key]) formatOptions[key] = val;
        if (val === "false") formatOptions[key] = false;
        if (val === "true") formatOptions[key] = true;
        if (!Number.isNaN(Number(val)) && val !== "") formatOptions[key] = parseInt(val, 10);
      });
    }
  }
  return { formatName, formatOptions };
}

const FORMATTERS: Record<string, (val: unknown, lng: string, opt: Record<string, unknown>) => string> = {
  number: (v, l, o) => new Intl.NumberFormat(l, o as Intl.NumberFormatOptions).format(v as number),
  currency: (v, l, o) =>
    new Intl.NumberFormat(l, { ...(o as Intl.NumberFormatOptions), style: "currency" }).format(v as number),
  datetime: (v, l, o) => new Intl.DateTimeFormat(l, o as Intl.DateTimeFormatOptions).format(v as Date),
  relativetime: (v, l, o) =>
    new Intl.RelativeTimeFormat(l, o as Intl.RelativeTimeFormatOptions).format(
      v as number,
      ((o.range as string) || "day") as Intl.RelativeTimeFormatUnit
    ),
  list: (v, l, o) =>
    new (Intl as unknown as { ListFormat: new (l: string, o: unknown) => { format(v: unknown): string } }).ListFormat(
      l,
      o
    ).format(v),
};

function applyFormat(value: unknown, format: string, lng: string, options: Record<string, unknown>) {
  return format.split(",").reduce((mem, f) => {
    const { formatName, formatOptions } = parseFormat(f);
    const fn = FORMATTERS[formatName];
    if (!fn) return mem;
    try {
      const formatParams = options.formatParams as Record<string, Record<string, unknown>> | undefined;
      const valOptions = formatParams?.[options.interpolationkey as string] || {};
      const l =
        (valOptions.locale as string) ||
        (valOptions.lng as string) ||
        (options.locale as string) ||
        (options.lng as string) ||
        lng;
      return fn(mem, l, { ...formatOptions, ...options, ...valOptions });
    } catch {
      return mem;
    }
  }, value);
}

export type LightI18n = { t: TFunction; i18n: I18nInstance };

export function createLightI18n(locale: string, ns: string, resources: Resources): LightI18n {
  let pluralRules: Intl.PluralRules | null = null;
  let ordinalRules: Intl.PluralRules | null = null;
  const getRule = (ordinal?: boolean) => {
    try {
      if (ordinal) return (ordinalRules ??= new Intl.PluralRules(locale, { type: "ordinal" }));
      return (pluralRules ??= new Intl.PluralRules(locale, { type: "cardinal" }));
    } catch {
      return null;
    }
  };
  const getSuffix = (count: number, ordinal?: boolean) => {
    const rule = getRule(ordinal);
    if (!rule) return "";
    return `_${ordinal ? "ordinal_" : ""}${rule.select(count)}`;
  };

  const isValid = (v: unknown) => v !== undefined && v !== null;

  const getResource = (key: string) => {
    const direct = resources[key];
    if (direct !== undefined) return direct;
    return deepFind(resources, key);
  };

  const stripNs = (key: string) => {
    const i = key.indexOf(":");
    if (i > 0 && key.substring(0, i) === ns) return key.substring(i + 1);
    return key;
  };

  const resolve = (keys: string[], options: TOptions) => {
    let found: unknown;
    let usedKey = "";
    const count = options.count;
    const needsPlural = count !== undefined && typeof count !== "string";
    const needsZero = needsPlural && !options.ordinal && count === 0;
    const ctx = options.context;
    const needsContext = ctx !== undefined && (typeof ctx === "string" || typeof ctx === "number") && ctx !== "";
    for (const k of keys) {
      if (isValid(found)) break;
      const key = stripNs(k);
      usedKey = key;
      const finalKeys = [key];
      let pluralSuffix = "";
      if (needsPlural) pluralSuffix = getSuffix(count as number, options.ordinal);
      if (needsPlural) {
        finalKeys.push(key + pluralSuffix);
        if (options.ordinal && pluralSuffix.indexOf("_ordinal_") === 0)
          finalKeys.push(key + pluralSuffix.replace("_ordinal_", "_"));
        if (needsZero) finalKeys.push(`${key}_zero`);
      }
      if (needsContext) {
        const contextKey = `${key}_${ctx}`;
        finalKeys.push(contextKey);
        if (needsPlural) {
          finalKeys.push(contextKey + pluralSuffix);
          if (options.ordinal && pluralSuffix.indexOf("_ordinal_") === 0)
            finalKeys.push(contextKey + pluralSuffix.replace("_ordinal_", "_"));
          if (needsZero) finalKeys.push(`${contextKey}_zero`);
        }
      }
      let possible: string | undefined;
      while ((possible = finalKeys.pop())) {
        if (!isValid(found)) found = getResource(possible);
      }
    }
    return { found, usedKey };
  };

  const interpolate = (str: string, data: Record<string, unknown>, lng: string, options: TOptions) => {
    const escapeValue = options.interpolation?.escapeValue !== undefined ? options.interpolation.escapeValue : true;
    const skipOnVariables =
      options.interpolation?.skipOnVariables !== undefined ? options.interpolation.skipOnVariables : true;
    const handleFormat = (key: string) => {
      if (key.indexOf(",") < 0) return deepFind(data, key);
      const p = key.split(",");
      const k = p.shift()!.trim();
      const f = p.join(",").trim();
      return applyFormat(deepFind(data, k), f, lng, { ...options, ...data, interpolationkey: k });
    };
    const todos: { regex: RegExp; safe: (v: string) => string }[] = [
      { regex: /\{\{-(.+?)\}\}/g, safe: (v) => regexSafe(v) },
      { regex: /\{\{(.+?)\}\}/g, safe: (v) => (escapeValue ? regexSafe(escapeHtml(v) as string) : regexSafe(v)) },
    ];
    for (const todo of todos) {
      let replaces = 0;
      let match: RegExpExecArray | null;
      while ((match = todo.regex.exec(str))) {
        const matchedVar = match[1].trim();
        let value = handleFormat(matchedVar);
        if (value === undefined) {
          if (Object.prototype.hasOwnProperty.call(options, matchedVar)) {
            value = "";
          } else if (skipOnVariables) {
            continue;
          } else {
            value = "";
          }
        } else if (typeof value !== "string") {
          value = makeString(value);
        }
        const v = value as string;
        str = str.replace(match[0], todo.safe(v));
        if (skipOnVariables) {
          todo.regex.lastIndex += v.length;
          todo.regex.lastIndex -= match[0].length;
        } else {
          todo.regex.lastIndex = 0;
        }
        replaces++;
        if (replaces >= 1000) break;
      }
    }
    return str;
  };

  const nest = (str: string, options: TOptions, parentKeys: string[]) => {
    const nestingRegexp = /\$t\((.+?)\)/g;
    let match: RegExpExecArray | null;
    while ((match = nestingRegexp.exec(str))) {
      let cloned: TOptions = { ...options };
      cloned = (cloned.replace && typeof cloned.replace !== "string" ? cloned.replace : cloned) as TOptions;
      delete cloned.defaultValue;
      let key = match[1].trim();
      if (key.indexOf(",") >= 0) {
        const c = key.split(/,[ ]*{/);
        let optionsString = `{${c[1]}`;
        key = c[0];
        optionsString = interpolate(optionsString, cloned, locale, cloned);
        const single = optionsString.match(/'/g);
        const double = optionsString.match(/"/g);
        if ((single && single.length % 2 === 0 && !double) || (double && double.length % 2 !== 0)) {
          optionsString = optionsString.replace(/'/g, '"');
        }
        try {
          cloned = { ...cloned, ...JSON.parse(optionsString) };
          delete cloned.defaultValue;
        } catch {
          key = `${key},${optionsString}`;
        }
      }
      let value: unknown;
      if (parentKeys[0] === key && !options.context) {
        value = null;
      } else {
        value = translate(key, cloned, parentKeys);
      }
      if (typeof value !== "string") value = makeString(value);
      str = str.replace(match[0], value as string);
      nestingRegexp.lastIndex = 0;
    }
    return str;
  };

  function translate(keysIn: unknown, optionsIn?: unknown, parentKeys?: string[]): unknown {
    let options: TOptions =
      typeof optionsIn === "object" && optionsIn !== null
        ? { ...(optionsIn as TOptions) }
        : optionsIn !== undefined && typeof optionsIn !== "object"
          ? { defaultValue: optionsIn }
          : {};
    if (keysIn === undefined || keysIn === null) return "";
    const keys = Array.isArray(keysIn) ? keysIn.map(String) : [String(keysIn)];
    const lastKey = stripNs(keys[keys.length - 1]);
    const { found } = resolve(keys, options);
    let res: unknown = found;
    if (res && typeof res === "object") {
      if (!options.returnObjects) return `key '${lastKey} (${locale})' returned an object instead of string.`;
      const copy: Record<string, unknown> = Array.isArray(res) ? ([] as unknown as Record<string, unknown>) : {};
      for (const m of Object.keys(res as object)) {
        const deepKey = `${lastKey}.${m}`;
        const v = translate(deepKey, { ...options, joinArrays: false });
        copy[m] = v === deepKey ? (res as Record<string, unknown>)[m] : v;
      }
      return copy;
    }
    if (!isValid(res) && options.defaultValue !== undefined) {
      const count = options.count;
      const needsPlural = count !== undefined && typeof count !== "string";
      const suffix = needsPlural ? getSuffix(count as number, options.ordinal) : "";
      res = options[`defaultValue${suffix}`] || options.defaultValue;
    }
    if (!isValid(res)) res = lastKey;
    if (typeof res !== "string") return res;
    const data = (options.replace && typeof options.replace !== "string" ? options.replace : options) as Record<
      string,
      unknown
    >;
    const skipOnVariables =
      options.interpolation?.skipOnVariables !== undefined ? options.interpolation.skipOnVariables : true;
    const nestBefore = skipOnVariables ? (res.match(/\$t\((.+?)\)/g) || []).length : 0;
    let out = interpolate(res, data, options.lng || locale, options);
    if (skipOnVariables) {
      const nestAfter = (out.match(/\$t\((.+?)\)/g) || []).length;
      if (nestBefore < nestAfter) options = { ...options, nest: false };
    }
    if (options.nest !== false) out = nest(out, options, parentKeys ?? keys);
    return out;
  }

  const t = ((key: unknown, options?: unknown) => translate(key, options)) as unknown as TFunction;
  const exists = (key: string, options?: TOptions) => isValid(resolve([key], options ?? {}).found);

  const i18n = {
    language: locale,
    languages: [locale],
    resolvedLanguage: locale,
    isInitialized: true,
    t,
    exists,
    getFixedT: () => t,
    dir: (lng?: string) => {
      const l = (lng || locale).split("-")[0];
      return ["ar", "he", "iw", "fa", "ur", "ps", "yi", "ug", "dv", "ku", "sd"].includes(l) ? "rtl" : "ltr";
    },
    hasResourceBundle: () => true,
    getResource: (_lng: string, _ns: string, key: string) => getResource(key),
    options: { lng: locale, ns: [ns], defaultNS: ns },
  } as unknown as I18nInstance;

  return { t, i18n };
}

export const __test__ = { SUFFIX_ORDER };
