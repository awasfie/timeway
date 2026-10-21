import { AsyncLocalStorage } from "node:async_hooks";
import http from "node:http";
import { formatServerTiming, SERVER_TIMING_STORE } from "./requestTiming";

/**
 * WC-TW-6a3 decision: Server-Timing as a real response header for the booking page.
 *
 * App Router pages cannot set response headers and the proxy runs before render, so neither can
 * carry render timings. Instead each incoming request runs inside an AsyncLocalStorage store;
 * measure() writes phase durations into it, and writeHead (called by Node on the first flush of the
 * streamed shell) adds `Server-Timing: session, user, event`. Those phases finish before the shell
 * flushes. `slots` resolves inside the Suspense boundary after the headers are sent, so it stays in
 * the in-page JSON tag (id booking-server-timing). Durations only, no PII. Responses with no recorded
 * phase are untouched. Node runtime only; idempotent.
 */
const INSTALLED = Symbol.for("timeway.serverTiming.installed");

export function installServerTimingHeader() {
  const g = globalThis as Record<symbol, unknown>;
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;

  const als = new AsyncLocalStorage<Record<string, number>>();
  g[SERVER_TIMING_STORE] = als;

  const originalEmit = http.Server.prototype.emit as (...a: unknown[]) => boolean;
  http.Server.prototype.emit = function (this: http.Server, ...args: unknown[]) {
    if (args[0] === "request") return als.run({}, () => originalEmit.apply(this, args));
    return originalEmit.apply(this, args);
  } as typeof http.Server.prototype.emit;

  const originalWriteHead = http.ServerResponse.prototype.writeHead;
  http.ServerResponse.prototype.writeHead = function (this: http.ServerResponse, ...args: unknown[]) {
    const store = als.getStore();
    if (store && !this.headersSent && !this.hasHeader("Server-Timing")) {
      const value = formatServerTiming(store);
      if (value) this.setHeader("Server-Timing", value);
    }
    return (originalWriteHead as (...a: unknown[]) => http.ServerResponse).apply(this, args);
  } as typeof http.ServerResponse.prototype.writeHead;
}
