import { describe, expect, it } from "vitest";
import {
  classifyCustomHostPath,
  hostFromHeader,
  hostOfUrl,
  isPlatformHost,
  orgRootRewritePath,
} from "../hostRouting";

describe("hostFromHeader", () => {
  it.each([
    ["Book.Acme.com:443", "book.acme.com"],
    ["book.acme.com.", "book.acme.com"],
    ["[::1]:3000", "[::1]"],
    ["  localhost:3000 ", "localhost"],
    ["", ""],
  ])("%s -> %s", (input, expected) => {
    expect(hostFromHeader(input)).toBe(expected);
  });

  it("treats a missing header as empty", () => {
    expect(hostFromHeader(null)).toBe("");
    expect(hostFromHeader(undefined)).toBe("");
  });
});

describe("hostOfUrl", () => {
  it("returns the hostname or empty on garbage", () => {
    expect(hostOfUrl("https://App.Example.com:8443/x")).toBe("app.example.com");
    expect(hostOfUrl("not a url")).toBe("");
    expect(hostOfUrl(undefined)).toBe("");
  });
});

describe("isPlatformHost", () => {
  const own = ["app.example.com"];

  it.each([
    "timeway.co",
    "acme.timeway.co",
    "a.b.timeway.co",
    "localhost",
    "127.0.0.1",
    "[::1]",
    "",
    "app.example.com",
  ])("%s is a platform host", (host) => {
    expect(isPlatformHost(host, own)).toBe(true);
  });

  it.each([
    "book.acme.com",
    "timeway.co.evil.com",
    "eviltimeway.co",
    "timeway.com",
  ])("%s is a customer host", (host) => {
    expect(isPlatformHost(host, own)).toBe(false);
  });
});

describe("classifyCustomHostPath", () => {
  it("routes / and /embed to the org root", () => {
    expect(classifyCustomHostPath("/")).toEqual({ kind: "root", embed: false });
    expect(classifyCustomHostPath("/embed")).toEqual({ kind: "root", embed: true });
  });

  it.each([
    "/_next/data/x.json",
    "/booking/abc",
    "/reschedule/abc",
    "/cancel/abc",
    "/success/abc",
    "/api/book/event",
    "/favicon.ico",
    "/robots.txt",
    "/embed.js",
    "/logo.png",
  ])("%s passes through", (path) => {
    expect(classifyCustomHostPath(path)).toEqual({ kind: "passthrough" });
  });

  it.each([
    "/api/internal/custom-domain/resolve",
    "/api/auth/session",
    "/api/cron/x",
    "/settings/my-account",
    "/auth/login",
    "/login",
    "/bookings/upcoming",
    "/event-types",
    "/team",
    "/team/bad slug!",
    "/team/a/b/c/d",
    "/alice/30min/extra",
    "/alice/30min/notembed",
    "/%E0%A4%A",
  ])("%s is denied", (path) => {
    expect(classifyCustomHostPath(path)).toEqual({ kind: "deny" });
  });

  it("parses user and multi-user paths", () => {
    expect(classifyCustomHostPath("/Alice")).toEqual({ kind: "user", slugs: ["alice"] });
    expect(classifyCustomHostPath("/alice/30min")).toEqual({ kind: "user", slugs: ["alice"] });
    expect(classifyCustomHostPath("/alice/30min/embed")).toEqual({ kind: "user", slugs: ["alice"] });
    expect(classifyCustomHostPath("/alice+bob/30min")).toEqual({ kind: "user", slugs: ["alice", "bob"] });
  });

  it("treats dotted usernames as users, not static assets", () => {
    expect(classifyCustomHostPath("/john.doe")).toEqual({ kind: "user", slugs: ["john.doe"] });
    expect(classifyCustomHostPath("/jo.smith")).toEqual({ kind: "user", slugs: ["jo.smith"] });
    expect(classifyCustomHostPath("/mary_ann.lee")).toEqual({ kind: "user", slugs: ["mary_ann.lee"] });
    expect(classifyCustomHostPath("/logo.png")).toEqual({ kind: "passthrough" });
    expect(classifyCustomHostPath("/site.webmanifest")).toEqual({ kind: "passthrough" });
  });

  it("caps multi-user paths at 10 slugs", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}`).join("+");
    expect(classifyCustomHostPath(`/${eleven}`)).toEqual({ kind: "deny" });
  });

  it("parses team paths", () => {
    expect(classifyCustomHostPath("/team/Sales")).toEqual({ kind: "team", slug: "sales" });
    expect(classifyCustomHostPath("/team/sales/demo/embed")).toEqual({ kind: "team", slug: "sales" });
  });
});

describe("orgRootRewritePath", () => {
  it("matches the org-subdomain rewrite", () => {
    expect(orgRootRewritePath("acme", false)).toBe("/team/acme?isOrgProfile=1");
    expect(orgRootRewritePath("acme", true)).toBe("/team/acme/embed?isOrgProfile=1");
  });
});
