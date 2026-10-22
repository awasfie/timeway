import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// WC-TW-6c-4: markdown-it and sanitize-html (+postcss, htmlparser2) cost ~100 KB gz on the public
// booking page when they reach the client bundle. Labels and descriptions are rendered to safe HTML
// on the server (getPublicEvent / getBookingFieldsWithSystemFields); the client only re-sanitises
// with DOMPurify. This walks the static import graph of the booking page client entries and fails
// if a server-only markdown module becomes reachable again. Dynamic import() is lazy and allowed.

const repoRoot = resolve(__dirname, "../../../..");
const webRoot = join(repoRoot, "apps/web");

const ENTRIES = [
  "apps/web/modules/users/views/users-type-public-view.tsx",
  "apps/web/modules/team/type-view.tsx",
  "apps/web/modules/d/[link]/d-type-view.tsx",
];

const FORBIDDEN_FILES = ["packages/lib/markdownToSafeHTML.ts", "packages/lib/markdownIt.ts"];
const FORBIDDEN_PACKAGES = ["markdown-it", "sanitize-html", "postcss", "htmlparser2"];

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

const WEB_ALIASES: Record<string, string> = {
  "~/": "apps/web/modules/",
  "@components/": "apps/web/components/",
  "@lib/": "apps/web/lib/",
  "@server/": "apps/web/server/",
  "@pages/": "apps/web/pages/",
  "app/": "apps/web/app/",
  "@coss/ui/": "packages/coss-ui/src/",
};

function workspacePackages(): Map<string, string> {
  const map = new Map<string, string>();
  const visit = (dir: string, depth: number) => {
    if (depth > 3) return;
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(dir, name);
      if (!statSync(full).isDirectory()) continue;
      const pkgJson = join(full, "package.json");
      if (existsSync(pkgJson)) {
        const pkgName = JSON.parse(readFileSync(pkgJson, "utf8")).name as string | undefined;
        if (pkgName?.startsWith("@calcom/")) map.set(pkgName, full);
      }
      visit(full, depth + 1);
    }
  };
  visit(join(repoRoot, "packages"), 0);
  visit(join(repoRoot, "apps"), 0);
  return map;
}

const packages = workspacePackages();

function resolveFile(base: string): string | null {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) {
    const index = join(base, `index${ext}`);
    if (existsSync(index)) return index;
  }
  return null;
}

function resolveSpecifier(spec: string, fromFile: string): string | null {
  if (spec.startsWith(".")) return resolveFile(resolve(dirname(fromFile), spec));
  if (fromFile.startsWith(webRoot)) {
    for (const [alias, target] of Object.entries(WEB_ALIASES)) {
      if (spec.startsWith(alias)) return resolveFile(join(repoRoot, target, spec.slice(alias.length)));
    }
  }
  const m = spec.match(/^(@calcom\/[^/]+)(?:\/(.*))?$/);
  if (m) {
    const pkgDir = packages.get(m[1]);
    if (!pkgDir) return null;
    return resolveFile(m[2] ? join(pkgDir, m[2]) : pkgDir);
  }
  return null;
}

const IMPORT_RE =
  /(?:^|[;\n])\s*(import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']|(?:^|[;\n])\s*import\s*["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)/g;

function staticImports(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    if (m[4]) {
      if (m[2]) continue;
      const clause = m[3].trim();
      const braced = clause.match(/^\{([\s\S]*)\}$/);
      if (braced) {
        const names = braced[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (names.length > 0 && names.every((n) => n.startsWith("type "))) continue;
      }
      specs.push(m[4]);
    } else if (m[5]) specs.push(m[5]);
    else if (m[6]) specs.push(m[6]);
  }
  return specs;
}

function findForbiddenPaths(): string[] {
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const entry of ENTRIES) {
    const file = join(repoRoot, entry);
    expect(existsSync(file), `${entry} missing; update ENTRIES`).toBe(true);
    parent.set(file, null);
    queue.push(file);
  }
  const chain = (file: string) => {
    const out: string[] = [];
    for (let f: string | null | undefined = file; f; f = parent.get(f)) out.unshift(relative(repoRoot, f));
    return out.join(" -> ");
  };
  const hits: string[] = [];
  while (queue.length) {
    const file = queue.shift() as string;
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
    for (const spec of staticImports(source)) {
      const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (FORBIDDEN_PACKAGES.includes(pkg)) {
        hits.push(`${chain(file)} -> ${spec}`);
        continue;
      }
      const target = resolveSpecifier(spec, file);
      if (!target || target.includes("/node_modules/") || parent.has(target)) continue;
      parent.set(target, file);
      if (FORBIDDEN_FILES.includes(relative(repoRoot, target))) {
        hits.push(chain(target));
        continue;
      }
      queue.push(target);
    }
  }
  return hits;
}

describe("booking page client bundle", () => {
  it("does not statically import server-only markdown/sanitize modules", () => {
    expect(findForbiddenPaths()).toEqual([]);
  }, 60_000);
});
