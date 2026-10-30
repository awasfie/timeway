// WC-TW-6g: unit tests for the booking edge Worker. Run: node --test ops/cloudflare/worker/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import worker, { bypassReason, cacheKey, isBookingPath, languageBucket } from "./booking-edge.mjs";
import { deferChunkScripts, deferSegment, LOADER } from "./defer-js.mjs";
import { LOCALES } from "./locales.mjs";

const req = (path, init = {}) => {
  const r = new Request(`https://timeway.co${path}`, init);
  return [r, new URL(r.url)];
};

test("locales.mjs matches i18n.json", () => {
  const { locale } = JSON.parse(readFileSync(new URL("../../../i18n.json", import.meta.url)));
  assert.deepEqual(LOCALES, [...locale.targets, locale.source]);
});

test("isBookingPath: only /<user>/<type>", () => {
  for (const p of ["/ahmedwasfie/30min", "/someone/intro-call"]) assert.ok(isBookingPath(p), p);
  for (const p of [
    "/",
    "/ahmedwasfie",
    "/ahmedwasfie/30min/",
    "/ahmedwasfie/30min/embed",
    "/api/trpc",
    "/_next/static",
    "/auth/login",
    "/apps/installed",
    "/settings/my-account",
    "/bookings/upcoming",
    "/event-types/12",
    "/availability/3",
    "/team/acme",
    "/ahmedwasfie/avatar.png",
    "/fonts/x.woff2",
  ])
    assert.equal(isBookingPath(p), false, p);
});

test("languageBucket mirrors getLocale for anonymous visitors", () => {
  const cases = {
    "": "en",
    "en-US,en;q=0.9": "en",
    "ar-AE,ar;q=0.9,en;q=0.8": "ar",
    "AR": "ar",
    "de;q=0.5, fr": "fr",
    "pt-BR": "pt-BR",
    "pt-PT": "pt",
    "es-419": "es",
    "zh-CN": "zh-CN",
    "zh-HK": "zh-HK",
    "zh": "zh",
    "xx-YY": "en",
    "*": "en",
    "en-verylongregion": "en",
  };
  for (const [header, want] of Object.entries(cases)) assert.equal(languageBucket(header), want, header);
});

test("bypassReason", () => {
  assert.equal(bypassReason(...req("/ahmedwasfie/30min")), null);
  assert.equal(bypassReason(...req("/ahmedwasfie/30min?utm_source=x")), null);
  assert.equal(bypassReason(...req("/ahmedwasfie/30min?rescheduleUid=1")), "query");
  assert.equal(bypassReason(...req("/ahmedwasfie/30min", { method: "POST" })), "method");
  assert.equal(bypassReason(...req("/api/me")), "path");
  for (const c of ["next-auth.session-token=a", "x=1; __Secure-next-auth.session-token=a", "__Secure-next-auth.session-token.0=a"])
    assert.equal(bypassReason(...req("/ahmedwasfie/30min", { headers: { cookie: c } })), "session", c);
  assert.equal(bypassReason(...req("/ahmedwasfie/30min", { headers: { cookie: "theme=dark" } })), null);
  assert.equal(bypassReason(...req("/ahmedwasfie/30min", { headers: { rsc: "1" } })), "rsc");
});

test("cacheKey ignores query and case of bucket", () => {
  const [, u1] = req("/a/b?utm_source=x");
  const [, u2] = req("/a/b");
  assert.equal(cacheKey(u1, "pt-BR").url, cacheKey(u2, "pt-br").url);
  assert.notEqual(cacheKey(u2, "en").url, cacheKey(u2, "ar").url);
});

// In-memory Cache API and origin stub to exercise HIT / MISS / STALE / BYPASS.
function harness(originImpl) {
  const store = new Map();
  globalThis.caches = {
    default: {
      match: async (k) => store.get(k.url)?.clone(),
      put: async (k, r) => void store.set(k.url, r),
      delete: async (k) => store.delete(k.url),
    },
  };
  const calls = [];
  globalThis.fetch = async (r) => {
    calls.push(r);
    return originImpl(r);
  };
  const run = async (path, init) => {
    const waits = [];
    const res = await worker.fetch(new Request(`https://timeway.co${path}`, init), {}, {
      waitUntil: (p) => waits.push(p),
      passThroughOnException: () => {},
    });
    await Promise.all(waits);
    return res;
  };
  return { store, calls, run };
}

const html = (body, extra = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...extra } });

test("MISS then HIT; origin sees normalized language and no cookie", async () => {
  const h = harness((r) => html(`lang=${r.headers.get("accept-language")}`));
  const a = await h.run("/ahmedwasfie/30min", { headers: { "accept-language": "ar-AE,ar;q=0.9", cookie: "theme=1" } });
  assert.equal(a.headers.get("x-tw-edge"), "MISS");
  assert.equal(await a.text(), "lang=ar");
  assert.equal(h.calls[0].headers.get("cookie"), null);
  assert.match(a.headers.get("cache-control"), /no-store/);
  const b = await h.run("/ahmedwasfie/30min", { headers: { "accept-language": "ar" } });
  assert.equal(b.headers.get("x-tw-edge"), "HIT");
  assert.equal(await b.text(), "lang=ar");
  assert.equal(h.calls.length, 1);
  const c = await h.run("/ahmedwasfie/30min", { headers: { "accept-language": "en-US" } });
  assert.equal(c.headers.get("x-tw-edge"), "MISS");
});

test("logged-in request is BYPASS and never stored", async () => {
  const h = harness(() => html("private"));
  const r = await h.run("/ahmedwasfie/30min", { headers: { cookie: "__Secure-next-auth.session-token=abc" } });
  assert.equal(r.headers.get("x-tw-edge"), "BYPASS");
  assert.equal(h.store.size, 0);
  assert.equal(h.calls[0].headers.get("cookie"), "__Secure-next-auth.session-token=abc");
});

test("non-200 or Set-Cookie from origin is not stored", async () => {
  for (const res of [() => new Response("nf", { status: 404, headers: { "content-type": "text/html" } }), () => html("x", { "set-cookie": "a=b" })]) {
    const h = harness(res);
    const r = await h.run("/ahmedwasfie/30min");
    assert.equal(r.headers.get("x-tw-edge"), "BYPASS");
    assert.equal(h.store.size, 0);
  }
});

test("stale entry is served and refreshed in the background; deleted event is evicted", async () => {
  let body = "v1";
  let status = 200;
  const h = harness(() => (status === 200 ? html(body) : new Response("gone", { status, headers: { "content-type": "text/html" } })));
  await h.run("/a/b");
  const [k] = h.store.keys();
  const age = (s) => {
    const old = h.store.get(k);
    const hd = new Headers(old.headers);
    hd.set("x-tw-stored-at", String(Date.now() - s * 1000));
    h.store.set(k, new Response(old.body, { status: 200, headers: hd }));
  };
  age(120);
  body = "v2";
  const s = await h.run("/a/b");
  assert.equal(s.headers.get("x-tw-edge"), "STALE");
  assert.equal(await s.text(), "v1");
  const f = await h.run("/a/b");
  assert.equal(f.headers.get("x-tw-edge"), "HIT");
  assert.equal(await f.text(), "v2");
  age(120);
  status = 404;
  await h.run("/a/b");
  assert.equal(h.store.size, 0);

  const m = await h.run("/a/b");
  assert.equal(m.headers.get("x-tw-edge"), "BYPASS");
});

test("entry older than max stale is a plain miss", async () => {
  const h = harness(() => html("v"));
  await h.run("/a/b");
  const [k] = h.store.keys();
  const old = h.store.get(k);
  const hd = new Headers(old.headers);
  hd.set("x-tw-stored-at", String(Date.now() - 3600 * 1000));
  h.store.set(k, new Response(old.body, { status: 200, headers: hd }));
  const r = await h.run("/a/b");
  assert.equal(r.headers.get("x-tw-edge"), "MISS");
});

// WC-TW-6l-3: chunk scripts are requested after first paint.
const NEXT_HEAD =
  '<head><link rel="stylesheet" href="/_next/static/chunks/a.css" data-precedence="next"/>' +
  '<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/41-x.js"/>' +
  '<link rel="preload" href="/_next/static/media/f.woff2" as="font" crossorigin=""/>' +
  '<script src="/_next/static/chunks/turbopack-1.js" async=""></script>' +
  '<script src="/_next/static/chunks/abc_-1.js" async=""></script>' +
  '<script src="/_next/static/chunks/poly.js" noModule=""></script></head>' +
  '<body><h1>30 min</h1><script>self.__next_f.push([0])</script></body></html>';

test("deferSegment: async chunk scripts go inert, script preloads drop, rest untouched", () => {
  const out = deferSegment(NEXT_HEAD);
  assert.equal((out.match(/type="text\/tw-deferred"/g) || []).length, 2);
  assert.match(out, /data-tw-src="\/_next\/static\/chunks\/turbopack-1.js"/);
  assert.doesNotMatch(out, /as="script"/);
  assert.match(out, /as="font"/);
  assert.match(out, /a\.css/);
  assert.match(out, /poly\.js" noModule/);
  assert.match(out, /self\.__next_f\.push/);
  assert.match(out, /<h1>30 min<\/h1>/);
});

test("deferChunkScripts: same result for any stream split; loader appended once", async () => {
  const enc = new TextEncoder().encode(NEXT_HEAD);
  const whole = deferSegment(NEXT_HEAD) + LOADER;
  for (const size of [1, 7, 64, enc.length]) {
    const rs = new ReadableStream({
      start(c) {
        for (let i = 0; i < enc.length; i += size) c.enqueue(enc.subarray(i, i + size));
        c.close();
      },
    });
    assert.equal(await new Response(deferChunkScripts(rs)).text(), whole, `split ${size}`);
  }
});

test("deferChunkScripts: HTML without chunk scripts passes through unchanged", async () => {
  const src = "<html><body>plain <b>page</b></body></html>";
  assert.equal(await new Response(deferChunkScripts(new Response(src).body)).text(), src);
});

test("stored booking HTML is deferred: MISS and HIT both carry the loader, no script preload", async () => {
  const h = harness(() => html(NEXT_HEAD, { "content-length": String(NEXT_HEAD.length) }));
  const a = await h.run("/ahmedwasfie/30min");
  const at = await a.text();
  assert.equal(a.headers.get("x-tw-defer"), "1");
  assert.equal(a.headers.get("content-length"), null);
  assert.ok(at.endsWith(LOADER));
  assert.doesNotMatch(at, /<script src="\/_next[^>]*async/);
  const b = await h.run("/ahmedwasfie/30min");
  assert.equal(b.headers.get("x-tw-edge"), "HIT");
  assert.equal(await b.text(), at);
});

test("BYPASS (logged-in) HTML is not rewritten", async () => {
  const h = harness(() => html(NEXT_HEAD));
  const r = await h.run("/ahmedwasfie/30min", { headers: { cookie: "next-auth.session-token=abc" } });
  assert.equal(await r.text(), NEXT_HEAD);
});
