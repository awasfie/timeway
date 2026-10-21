import { describe, expect, it } from "vitest";
import {
  STATIC_SHELL_CACHE_CONTROL,
  STATIC_SHELL_SOURCES,
  staticShellHeaders,
} from "../../lib/edgeCacheHeaders";

/* eslint-disable @typescript-eslint/no-require-imports */
const { pathToRegexp } = require("next/dist/compiled/path-to-regexp");

const matchesShell = (path: string) => STATIC_SHELL_SOURCES.some((source) => pathToRegexp(source).test(path));

describe("edge cache headers (WC-TW-6b)", () => {
  it("lets the edge keep the shell for a week with SWR", () => {
    expect(STATIC_SHELL_CACHE_CONTROL).toContain("public");
    expect(STATIC_SHELL_CACHE_CONTROL).toContain("s-maxage=604800");
    expect(STATIC_SHELL_CACHE_CONTROL).toContain("stale-while-revalidate=86400");
    for (const rule of staticShellHeaders()) {
      expect(rule.headers).toEqual([{ key: "Cache-Control", value: STATIC_SHELL_CACHE_CONTROL }]);
    }
  });

  it.each([
    "/fonts/Inter-roman.var.woff2",
    "/fonts/brand/DMSans-Regular.woff2",
    "/favicon.ico",
    "/favicon-32x32.png",
    "/apple-touch-icon.png",
    "/android-chrome-512x512.png",
    "/mstile-150x150.png",
    "/safari-pinned-tab.svg",
    "/cal-logo-word.svg",
  ])("marks static asset %s cacheable", (path) => {
    expect(matchesShell(path)).toBe(true);
  });

  it.each([
    "/",
    "/auth/login",
    "/ahmed/30min",
    "/ahmed/30min/embed",
    "/api/me",
    "/api/trpc/slots/getSchedule",
    "/trpc/viewer.me",
    "/bookings/upcoming",
    "/settings/my-account/profile",
    "/ahmed/avatar.png",
    "/favicon-evil.png",
  ])("never marks %s publicly cacheable", (path) => {
    expect(matchesShell(path)).toBe(false);
  });
});
