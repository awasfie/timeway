// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";
import { measure, recordTiming } from "@lib/booking/requestTiming";
import { installServerTimingHeader } from "@lib/booking/serverTimingHeader";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// WC-TW-6a3 decision 1: session/user/event become a real Server-Timing header on the first flush;
// slots (resolved after the shell is streamed) never reaches the header.
describe("installServerTimingHeader", () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    installServerTimingHeader();
    installServerTimingHeader(); // idempotent
    server = http.createServer(async (req, res) => {
      const key = {};
      if (req.url === "/booking") {
        await Promise.all([
          measure(key, "session", Promise.resolve()),
          measure(key, "user", Promise.resolve()),
          measure(key, "event", new Promise((r) => setTimeout(r, 5))),
        ]);
        res.writeHead(200, { "content-type": "text/html" });
        res.write("<shell>");
        recordTiming(key, "slots", 42); // after headers are sent
        res.end("</shell>");
        return;
      }
      if (req.url === "/preset") {
        recordTiming(key, "session", 1);
        res.setHeader("Server-Timing", "app;dur=1");
        res.end("ok");
        return;
      }
      res.end("plain");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  const get = (path: string) =>
    new Promise<{ header: string | undefined; body: string }>((resolve, reject) => {
      http
        .get(`${base}${path}`, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ header: res.headers["server-timing"] as string | undefined, body }));
        })
        .on("error", reject);
    });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("sets session, user, event before the first flush and leaves slots out", async () => {
    const { header = "", body } = await get("/booking");
    expect(header).toMatch(/^session;dur=[\d.]+, user;dur=[\d.]+, event;dur=[\d.]+$/);
    expect(header).not.toContain("slots");
    expect(body).toBe("<shell></shell>");
  });

  it("does not leak timings across requests", async () => {
    await get("/booking");
    expect((await get("/plain")).header).toBeUndefined();
  });

  it("never overwrites an existing Server-Timing header", async () => {
    expect((await get("/preset")).header).toBe("app;dur=1");
  });
});
