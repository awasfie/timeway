import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  deferHydrationChunks,
  FRONT_DOOR_RAW_HEADER,
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
