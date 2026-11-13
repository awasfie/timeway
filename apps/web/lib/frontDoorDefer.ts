import http from "node:http";
import process from "node:process";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * UX.13.3-3f (t_66e18c15): the signed-out front door (GET /) asks for its hydration chunks only after
 * the first paint.
 *
 * Why: the hero h1 is server-rendered and paints at ~30-130 ms observed, but Next 16.4.1 emits the app
 * router bootstrap as `<script async>` tags in <head> (React bootstrapScripts + ReactDOM.preinit, no
 * option to delay them). When those chunks evaluate before the first paint, Lighthouse's simulated
 * graph places ~900 ms of x4 CPU in front of LCP (marketing-home 1806 vs 2737 ms, bimodal). Requesting
 * them after the LCP entry measured 1215-1366 ms (t_a3683099).
 *
 * How: the proxy renders / once more over loopback (header FRONT_DOOR_RAW_HEADER, so this code passes
 * it straight through), swaps every async /_next/static chunk tag for one inline loader, and returns
 * the result. Option (a), serving / with no client JS, was rejected: LandingPage is a client tree
 * (locale switch, mobile nav, analytics, RUM, speculation rules) and the RSC prefetch of
 * /pricing, /login and /signup needs the app router running. Any failure falls back to the normal
 * render (NextResponse.next()).
 */

const SESSION_COOKIES: string[] = ["next-auth.session-token", "__Secure-next-auth.session-token"];

/** Same request headers the proxy must not forward to the loopback render. */
const HOP_BY_HOP: Set<string> = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "accept-encoding",
  "content-length",
]);

const ASYNC_CHUNK_TAG = /<script\b([^>]*)><\/script>/g;
const SRC_ATTR = /\bsrc="(\/_next\/static\/[^"]+)"/;
const ASYNC_ATTR = /\basync(?:="")?(?=[\s>]|$)/;
const NONCE_ATTR = /\bnonce="([^"]+)"/;

/**
 * Swap the async /_next/static chunk tags for a post-paint loader. Returns null when the HTML has no
 * such tags or no </body> (nothing to do, serve the original).
 */
export function deferHydrationChunks(html: string): string | null {
  const bodyEnd = html.lastIndexOf("</body>");
  if (bodyEnd === -1) return null;
  const srcs: string[] = [];
  let nonce = "";
  const out = html.replace(ASYNC_CHUNK_TAG, (tag, attrs: string) => {
    const src = SRC_ATTR.exec(attrs);
    if (!src || !ASYNC_ATTR.test(attrs) || /\bnomodule\b/i.test(attrs)) return tag;
    srcs.push(src[1]);
    const n = NONCE_ATTR.exec(attrs);
    if (n && !nonce) nonce = n[1];
    return "";
  });
  if (srcs.length === 0) return null;
  if (!nonce) {
    const n = NONCE_ATTR.exec(html);
    if (n) nonce = n[1];
  }
  const end = out.lastIndexOf("</body>");
  return `${out.slice(0, end)}${postPaintLoader(srcs, nonce)}${out.slice(end)}`;
}

/**
 * Inline loader: append the chunks in their original order (async, as Next emitted them) 50 ms after
 * the first largest-contentful-paint entry. Fallbacks so hydration never waits on a missing entry:
 * no LCP observer support -> after the next frame; first input or a 3 s cap -> at once.
 */
export function postPaintLoader(srcs: string[], nonce: string = ""): string {
  const cleanNonce = nonce.replace(/[^A-Za-z0-9+/=_-]/g, "");
  let nonceAttr = "";
  if (cleanNonce) nonceAttr = ` nonce="${cleanNonce}"`;
  const list = JSON.stringify(srcs).replace(/</g, "\\u003c");
  const js =
    `(function(){var s=${list},d=document,w=window,done=0;` +
    `function go(){if(done)return;done=1;for(var i=0;i<s.length;i++){var e=d.createElement("script");e.src=s[i];e.async=true;d.head.appendChild(e)}}` +
    `function later(){setTimeout(go,50)}` +
    `try{new PerformanceObserver(function(l,o){o.disconnect();later()}).observe({type:"largest-contentful-paint",buffered:true})}` +
    `catch(_){w.requestAnimationFrame?requestAnimationFrame(later):later()}` +
    `["pointerdown","keydown","touchstart"].forEach(function(t){w.addEventListener(t,go,{once:true,passive:true,capture:true})});` +
    `setTimeout(go,3000)})()`;
  return `<script${nonceAttr} data-tw-defer="">${js}</script>`;
}

/** Only the signed-out HTML document request for / is deferred. */
export function shouldDeferFrontDoor(req: NextRequest): boolean {
  if (req.method !== "GET") return false;
  if (req.nextUrl.pathname !== "/") return false;
  if (req.headers.get(FRONT_DOOR_RAW_HEADER)) return false;
  // RSC navigations and prefetches of / carry these; they are not HTML.
  if (
    req.headers.get("rsc") ||
    req.headers.get("next-router-prefetch") ||
    req.nextUrl.searchParams.has("_rsc")
  )
    return false;
  if (!(req.headers.get("accept") ?? "").includes("text/html")) return false;
  if (SESSION_COOKIES.some((name) => req.cookies.has(name))) return false;
  return true;
}

type Raw = { status: number; headers: http.IncomingHttpHeaders; body: string };

function renderOverLoopback(req: NextRequest, headers: Headers): Promise<Raw> {
  const port = Number(process.env.PORT || 3000);
  const outHeaders: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name.toLowerCase())) outHeaders[name] = value;
  });
  outHeaders[FRONT_DOOR_RAW_HEADER] = "raw";
  outHeaders["accept-encoding"] = "identity";
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: "127.0.0.1",
        port,
        path: `${req.nextUrl.pathname}${req.nextUrl.search}`,
        method: "GET",
        headers: outHeaders,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          body += c;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 500, headers: res.headers, body }));
        res.on("error", reject);
      }
    );
    r.setTimeout(15000, () => r.destroy(new Error("front-door loopback timeout")));
    r.on("error", reject);
    r.end();
  });
}

const DROP_RESPONSE_HEADERS: Set<string> = new Set([
  "content-length",
  "transfer-encoding",
  "content-encoding",
  "connection",
  "keep-alive",
]);

/**
 * Render / over loopback and return it with deferred chunks; null means "serve normally".
 * `headers` are the request headers the normal path would forward (CSP nonce, pathname header).
 */
export async function deferredFrontDoor(req: NextRequest, headers: Headers): Promise<NextResponse | null> {
  let raw: Raw;
  try {
    raw = await renderOverLoopback(req, headers);
  } catch {
    return null;
  }
  if (raw.status !== 200 || !String(raw.headers["content-type"] ?? "").includes("text/html")) return null;
  const html = deferHydrationChunks(raw.body);
  if (html === null) return null;
  const out = new Headers();
  for (const [name, value] of Object.entries(raw.headers)) {
    if (value === undefined || DROP_RESPONSE_HEADERS.has(name)) continue;
    if (Array.isArray(value)) {
      for (const v of value) out.append(name, v);
    } else {
      out.set(name, value);
    }
  }
  return new NextResponse(html, { status: 200, headers: out });
}

export const FRONT_DOOR_RAW_HEADER = "x-tw-front-door";
