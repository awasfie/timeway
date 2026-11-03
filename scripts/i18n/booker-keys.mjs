#!/usr/bin/env node
// WC-TW-6c-9c-2b: the common.json keys the public booking routes can render, so the root layout and the
// booking pages serialise only this subset into the RSC flight data (not the whole 320 KB dictionary).
// Walks the import graph from the booking route entries (static, dynamic and re-exports; type-only
// imports skipped) with the TypeScript parser and keeps every string literal in a reached file that is a
// common.json key. That covers
// t("...") calls and the dynamic keys passed through variables (form-builder default labels, t(status) maps).
// Template literals add every key with their static prefix; each key adds its plural forms and the keys
// its value nests via $t(...).
// Usage: node scripts/i18n/booker-keys.mjs          (writes packages/i18n/booker-keys.json)
//        node scripts/i18n/booker-keys.mjs --check  (exit 1 if the committed list is stale)
//        --verbose lists in-repo imports the walk could not resolve
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outPath = join(root, "packages/i18n/booker-keys.json");
const web = join(root, "apps/web");

// Everything that renders under the root layout's subset provider: every app/ route outside
// (use-page-wrapper) (whose layout passes the full dictionary) and outside api/.
const APP_DIR = "apps/web/app";
const SKIP_APP_DIRS = new Set(["(use-page-wrapper)", "api"]);
// Keys rendered by code the walk cannot see as literals (keep short; each line says why).
const EXTRA_KEYS = [];

const EXTS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"];
const WEB_ALIASES = [
  ["~/", "modules/"],
  ["@components/", "components/"],
  ["@pages/", "pages/"],
  ["@lib/", "lib/"],
  ["@server/", "server/"],
  ["app/", "app/"],
];

function packageDirs() {
  const map = new Map();
  const scan = (dir) => {
    for (const name of readdirSync(dir)) {
      const pkgDir = join(dir, name);
      const pj = join(pkgDir, "package.json");
      if (existsSync(pj)) {
        const { name: pkgName } = JSON.parse(readFileSync(pj, "utf8"));
        if (pkgName?.startsWith("@calcom/")) map.set(pkgName, pkgDir);
      }
    }
  };
  scan(join(root, "packages"));
  scan(join(root, "packages/platform"));
  scan(join(root, "packages/app-store"));
  scan(join(root, "packages/embeds"));
  map.set("@calcom/web", web);
  map.set("@calcom/repository", join(root, "packages/lib/server/repository"));
  map.set("@coss/ui", join(root, "packages/coss-ui/src"));
  return map;
}
const PKGS = packageDirs();

function resolveFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext;
  if (existsSync(base) && statSync(base).isDirectory())
    for (const ext of EXTS) if (existsSync(join(base, `index${ext}`))) return join(base, `index${ext}`);
  return null;
}

function resolveSpec(spec, fromFile) {
  if (spec.startsWith(".")) return resolveFile(resolve(dirname(fromFile), spec));
  if (fromFile.startsWith(`${web}/`))
    for (const [alias, target] of WEB_ALIASES)
      if (spec.startsWith(alias)) {
        const hit = resolveFile(join(web, target, spec.slice(alias.length)));
        if (hit) return hit;
      }
  const parts = spec.split("/");
  const pkgName = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const pkgDir = PKGS.get(pkgName);
  if (!pkgDir) return null;
  const sub = parts.slice(spec.startsWith("@") ? 2 : 1).join("/");
  return resolveFile(join(pkgDir, sub)) ?? (sub ? resolveFile(join(pkgDir, "src", sub)) : null);
}

// Every module specifier (static/dynamic import, re-export, require) and every string literal of a file,
// read with the TypeScript parser so comments, regexes and template literals cannot desync the scan.
function scan(file, src) {
  const kind = file.endsWith(".tsx") || file.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, false, kind);
  const specs = [];
  const literals = [];
  const templateHeads = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause?.isTypeOnly) specs.push(node.moduleSpecifier.text);
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && !node.isTypeOnly) specs.push(node.moduleSpecifier.text);
      return;
    }
    if (ts.isImportTypeNode(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node))
      return;
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      specs.push(node.arguments[0].text);
    if (ts.isStringLiteralLike(node)) literals.push(node.text);
    else if (ts.isTemplateHead(node)) templateHeads.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { specs, literals, templateHeads };
}

function listEntries() {
  const out = [];
  const walk = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) for (const n of readdirSync(p)) walk(join(p, n));
    else if (/\.(tsx?|jsx?)$/.test(p) && !/\.(test|spec)\.[jt]sx?$/.test(p)) out.push(p);
  };
  for (const name of readdirSync(join(root, APP_DIR)))
    if (!SKIP_APP_DIRS.has(name)) walk(join(root, APP_DIR, name));
  return out;
}

export function collectKeys() {
  const en = JSON.parse(readFileSync(join(root, "packages/i18n/locales/en/common.json"), "utf8"));
  const allKeys = Object.keys(en);
  const keySet = new Set(allKeys);
  const keys = new Set(EXTRA_KEYS);
  const prefixes = new Set();
  const seen = new Set();
  const unresolved = new Set();
  const queue = listEntries();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || file.includes("/node_modules/") || !/\.[mc]?[jt]sx?$/.test(file)) continue;
    if (/\.(test|spec)\.[jt]sx?$/.test(file)) continue;
    seen.add(file);
    const { specs, literals, templateHeads } = scan(file, readFileSync(file, "utf8"));
    for (const spec of specs) {
      const hit = resolveSpec(spec, file);
      if (hit && !seen.has(hit)) queue.push(hit);
      else if (!hit && /^(\.|@calcom\/|@coss\/|~\/|@lib\/|@components\/|@server\/|app\/)/.test(spec))
        unresolved.add(`${spec} <- ${relative(root, file)}`);
    }
    for (const lit of literals) if (keySet.has(lit)) keys.add(lit);
    // `prefix_${x}`: a dynamic key family; only prefixes ending on a key separator, to stay narrow.
    for (const head of templateHeads) if (/^[a-z0-9_]{3,}[_.]$/i.test(head)) prefixes.add(head);
  }
  for (const p of prefixes) for (const k of allKeys) if (k.startsWith(p)) keys.add(k);
  const pluralRe = /_(zero|one|two|few|many|other)$/;
  for (const k of allKeys) {
    const base = k.replace(pluralRe, "");
    if (base !== k && keys.has(base)) keys.add(k);
  }
  const nested = [...keys];
  while (nested.length) {
    const k = nested.pop();
    for (const m of String(en[k] ?? "").matchAll(/\$t\(\s*([A-Za-z0-9_.-]+)/g))
      if (keySet.has(m[1]) && !keys.has(m[1])) {
        keys.add(m[1]);
        nested.push(m[1]);
      }
  }
  if (process.env.BK_SEEN)
    writeFileSync(
      process.env.BK_SEEN,
      [...seen]
        .map((f) => relative(root, f))
        .sort()
        .join("\n")
    );
  return {
    keys: [...keys].filter((k) => keySet.has(k)).sort(),
    files: seen.size,
    total: allKeys.length,
    unresolved,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { keys, files, total, unresolved } = collectKeys();
  if (process.argv.includes("--verbose")) for (const u of unresolved) console.log(`unresolved: ${u}`);
  const body = `${JSON.stringify(keys, null, 2)}\n`;
  const rel = relative(root, outPath);
  if (process.argv.includes("--check")) {
    const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
    if (current !== body) {
      console.error(`::error::${rel} is stale; run node scripts/i18n/booker-keys.mjs and commit it`);
      process.exit(1);
    }
    console.log(`${rel} current: ${keys.length}/${total} keys from ${files} files`);
  } else {
    writeFileSync(outPath, body);
    console.log(`wrote ${rel}: ${keys.length}/${total} keys from ${files} files`);
  }
}
