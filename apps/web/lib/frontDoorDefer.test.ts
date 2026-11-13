import http from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deferHydrationChunks,
  deferredFrontDoor,
  FRONT_DOOR_RAW_HEADER,
  loopbackRequestHeaders,
  postPaintLoader,
  shouldDeferFrontDoor,
} from "./frontDoorDefer";

const HTML: string =
  '<!DOCTYPE html><html><head><link rel="stylesheet" href="/_next/static/chunks/a.css"/>' +
  '<script src="/_next/static/chunks/12k19.js" async=""></script>' +
  '<script src="/_next/static/chunks/2jg0.js" async=""></script>' +
  '<script src="/_next/static/chunks/0cz1.js" noModule=""></script>' +
  "</head><body><h1>Hi</h1><script>(self.__next_f=self.__next_f||[]).push([0])</script></body></html>";

const req = (path: string, headers: Record<string, string> = {}, method: string = "GET"): NextRequest =>
  new NextRequest(new URL(path, "http://localhost:3000"), {
    method,
    headers: { accept: "text/html,application/xhtml+xml", ...headers },
  });

describe("deferHydrationChunks", () => {
  it("moves async chunk tags into one post-paint loader at the end of body, in order", () => {
    const out = deferHydrationChunks(HTML);
    if (out === null) throw new Error("expected a deferred document");
    expect(out).not.toContain('<script src="/_next/static/chunks/12k19.js" async=""></script>');
    expect(out).not.toContain('<script src="/_next/static/chunks/2jg0.js" async=""></script>');
    // nomodule polyfill and inline flight data stay where they were
    expect(out).toContain('<script src="/_next/static/chunks/0cz1.js" noModule=""></script>');
    expect(out).toContain("self.__next_f");
    const loader = out.slice(out.indexOf("data-tw-defer"));
    expect(loader).toContain('["/_next/static/chunks/12k19.js","/_next/static/chunks/2jg0.js"]');
    expect(out.endsWith("</script></body></html>")).toBe(true);
    expect(out).toContain("largest-contentful-paint");
  });

  it("carries the CSP nonce of the chunk tags onto the loader", () => {
    const html = HTML.replace(/async=""/g, 'async="" nonce="abc123"');
    expect(deferHydrationChunks(html)).toContain('<script nonce="abc123" data-tw-defer="">');
  });

  it("matches closing tags with whitespace before the >", () => {
    const html =
      '<html><head><script src="/_next/static/chunks/a1.js" async=""></script ></head><body><h1>Hi</h1></body></html>';
    const out = deferHydrationChunks(html);
    expect(out).not.toContain("/_next/static/chunks/a1.js\" async");
    expect(out).toContain("/_next/static/chunks/a1.js");
    expect(out).toContain("<h1>Hi</h1>");
  });

  it("returns null when there is nothing to defer", () => {
    expect(deferHydrationChunks("<html><body>x</body></html>")).toBeNull();
    expect(deferHydrationChunks('<script src="/_next/static/x.js" async=""></script>')).toBeNull();
  });

  it("escapes < in chunk urls and strips odd nonce characters", () => {
    const tag = postPaintLoader(["/_next/static/</script>.js"], 'a"b');
    expect(tag).not.toContain("</script>.js");
    expect(tag).toContain('nonce="ab"');
  });
});

describe("shouldDeferFrontDoor", () => {
  it("defers the signed-out HTML request for /", () => {
    expect(shouldDeferFrontDoor(req("/"))).toBe(true);
  });
  it.each([
    ["another path", req("/pricing")],
    ["a POST", req("/", {}, "POST")],
    ["the loopback render", req("/", { [FRONT_DOOR_RAW_HEADER]: "raw" })],
    ["an RSC request", req("/", { rsc: "1" })],
    ["an RSC prefetch", req("/", { "next-router-prefetch": "1" })],
    ["an _rsc query", req("/?_rsc=abc")],
    ["a non-HTML accept", req("/", { accept: "*/*" })],
    ["a signed-in visitor", req("/", { cookie: "next-auth.session-token=x" })],
    ["a signed-in visitor (secure cookie)", req("/", { cookie: "__Secure-next-auth.session-token=x" })],
  ])("passes through %s", (_label, r) => {
    expect(shouldDeferFrontDoor(r)).toBe(false);
  });
});

describe("loopbackRequestHeaders", () => {
  it("copies the request headers (CSP nonce, pathname, cookies) minus hop-by-hop, marks the render raw", () => {
    const h = new Headers({
      host: "localhost:3000",
      cookie: "a=1",
      "x-csp-nonce": "n0nce",
      "x-pathname": "/",
      connection: "keep-alive",
      "keep-alive": "timeout=5",
      "transfer-encoding": "chunked",
      upgrade: "h2c",
      "content-length": "0",
      "accept-encoding": "gzip, br",
    });
    const out = loopbackRequestHeaders(h);
    expect(out).toMatchObject({
      host: "localhost:3000",
      cookie: "a=1",
      "x-csp-nonce": "n0nce",
      "x-pathname": "/",
    });
    for (const k of ["connection", "keep-alive", "transfer-encoding", "upgrade", "content-length"]) {
      expect(out[k]).toBeUndefined();
    }
    expect(out["accept-encoding"]).toBe("identity");
    expect(out[FRONT_DOOR_RAW_HEADER]).toBe("raw");
  });
});

describe("deferredFrontDoor (loopback)", () => {
  type Reply = { status?: number; type?: string; body?: string; cookies?: string[]; hang?: boolean };
  let reply: Reply = {};
  let seen: http.IncomingHttpHeaders = {};
  let port = 0;
  const server = http.createServer((rq, rs) => {
    seen = rq.headers;
    if (reply.hang) return;
    const headers: http.OutgoingHttpHeaders = { "content-type": reply.type ?? "text/html; charset=utf-8" };
    if (reply.cookies) headers["set-cookie"] = reply.cookies;
    rs.writeHead(reply.status ?? 200, headers);
    rs.end(reply.body ?? HTML);
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  afterEach(() => {
    reply = {};
    seen = {};
    warn.mockClear();
  });

  const call = (timeoutMs?: number): Promise<Response | null> => {
    const r = req("/?utm=x", { "x-csp-nonce": "n0nce", cookie: "a=1" });
    return deferredFrontDoor(r, r.headers, { port, timeoutMs });
  };

  it("renders over loopback with the request headers and returns the deferred document", async () => {
    const res = await call();
    if (!res) throw new Error("expected a response");
    expect(seen[FRONT_DOOR_RAW_HEADER]).toBe("raw");
    expect(seen["x-csp-nonce"]).toBe("n0nce");
    expect(seen.cookie).toBe("a=1");
    expect(seen["accept-encoding"]).toBe("identity");
    expect(res.status).toBe(200);
    expect(res.headers.get(FRONT_DOOR_RAW_HEADER)).toBe("deferred");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("data-tw-defer");
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps every Set-Cookie header of the loopback render", async () => {
    reply = { cookies: ["a=1; Path=/", "b=2; Path=/; HttpOnly"] };
    const res = await call();
    if (!res) throw new Error("expected a response");
    expect(res.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/; HttpOnly"]);
  });

  it.each([
    ["a non-200 render", { status: 500 }, "status-500"],
    ["a redirect", { status: 307 }, "status-307"],
    ["a non-HTML render", { type: "application/json", body: "{}" }, "not-html"],
    ["HTML with no async chunks", { body: "<html><body>x</body></html>" }, "no-chunks"],
  ])("falls back (null) on %s and logs the reason", async (_label, r: Reply, reason) => {
    reply = r;
    expect(await call()).toBeNull();
    expect(warn).toHaveBeenCalledWith(`[front-door-defer] fallback reason=${reason}`);
  });

  it("falls back on a loopback timeout", async () => {
    reply = { hang: true };
    expect(await call(50)).toBeNull();
    expect(warn).toHaveBeenCalledWith("[front-door-defer] fallback reason=timeout");
  });

  it("falls back when nothing listens on the loopback port", async () => {
    const r = req("/");
    expect(await deferredFrontDoor(r, r.headers, { port: 1 })).toBeNull();
    expect(warn).toHaveBeenCalledWith("[front-door-defer] fallback reason=error");
  });
});
