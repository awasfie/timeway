// Import mocked functions

import { WEBAPP_URL } from "@calcom/lib/constants";
import { clearCustomHostCache } from "@calcom/lib/domainManager/customHostnames/proxyGate";
import { get as edgeConfigGet } from "@vercel/edge-config";
import { NextRequest, NextResponse } from "next/server";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// We'll test the wrapped proxy as it would be used in production
import proxy, { config } from "./proxy";

// Mock dependencies at module level
vi.mock("@vercel/edge-config", () => ({
  get: vi.fn(),
}));

// Mock NextResponse.json since it's not available in test environment
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");

  // Create a NextResponse constructor that returns Response objects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const NextResponse = function (body: any, init?: ResponseInit) {
    return new Response(body, init);
  };

  // Add static methods
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  NextResponse.json = (body: any, init?: ResponseInit) => {
    return new Response(JSON.stringify(body), {
      ...init,
      headers: {
        ...init?.headers,
        "content-type": "application/json",
      },
    });
  };

  NextResponse.next = (init?: ResponseInit) => {
    const response = new Response(null, {
      status: 200,
      ...init,
      headers: {
        ...init?.headers,
        "x-middleware-next": "1",
      },
    });

    // Add cookies property
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (response as any).cookies = {
      delete: vi.fn(),
      set: vi.fn(),
      get: vi.fn(),
    };

    return response;
  };

  NextResponse.rewrite = (url: URL | string, init?: ResponseInit) => {
    const rewriteUrl = typeof url === "string" ? new URL(url) : url;
    return new Response(null, {
      status: 200,
      ...init,
      headers: {
        ...init?.headers,
        "x-middleware-rewrite": rewriteUrl.toString(),
      },
    });
  };

  NextResponse.redirect = (url: URL | string, statusOrInit?: number | ResponseInit) => {
    const redirectUrl = typeof url === "string" ? new URL(url) : url;
    const status = typeof statusOrInit === "number" ? statusOrInit : statusOrInit?.status || 307;
    const init = typeof statusOrInit === "object" ? statusOrInit : {};

    const response = new Response(null, {
      ...init,
      status,
      headers: {
        ...init.headers,
        location: redirectUrl.toString(),
      },
    });

    // Add cookies property
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (response as any).cookies = {
      delete: vi.fn(),
      set: vi.fn(),
      get: vi.fn(),
    };

    return response;
  };

  return {
    ...actual,
    NextResponse,
  };
});

const createTestRequest = (overrides?: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}) => {
  const url = overrides?.url || `${WEBAPP_URL}/test-path`;
  const method = overrides?.method || "GET";
  const headers = new Headers(overrides?.headers || {});

  const req = new NextRequest(new Request(url, { method, headers }));

  // Add cookies if provided
  if (overrides?.cookies) {
    Object.entries(overrides.cookies).forEach(([name, value]) => {
      req.cookies.set(name, value);
    });
  }

  return req;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createEdgeConfigMock = (config: Record<string, any>) => {
  return (key: string) => {
    if (key in config) return Promise.resolve(config[key]);
    return Promise.resolve(undefined);
  };
};

// Helper to safely get header value
const getHeader = (res: Response, name: string) => {
  return res.headers.get(name);
};

// Helper to check response status
const expectStatus = (res: Response, status: number) => {
  expect(res.status).toBe(status);
};

// Wrapper for proxy calls to handle type casting
const callProxy = async (req: NextRequest): Promise<Response> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (proxy as any)(req)) as Response;
};

describe("Middleware Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set test environment
    vi.stubEnv("NEXT_PUBLIC_WEBAPP_URL", WEBAPP_URL);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Static File Handling", () => {
    it("should skip processing for static files", async () => {
      const staticPaths = ["/images/logo.png", "/_next/static/main.js", "/favicon.ico"];

      for (const path of staticPaths) {
        const req = createTestRequest({ url: `${WEBAPP_URL}${path}` });
        const res = await callProxy(req);

        expect(res).toBeDefined();
        expectStatus(res, 200);
        expect(getHeader(res, "x-middleware-next")).toBe("1");
      }
    });
  });

  describe("Maintenance Mode", () => {
    it("should redirect to maintenance when enabled", async () => {
      (edgeConfigGet as Mock).mockImplementation(
        createEdgeConfigMock({
          isInMaintenanceMode: true,
        })
      );

      const req = createTestRequest({
        url: `${WEBAPP_URL}/team/test`,
      });

      const res = await callProxy(req);
      expect(res).toBeDefined();
      expectStatus(res, 200);
    });

    it("should not affect API routes in maintenance mode", async () => {
      (edgeConfigGet as Mock).mockImplementation(
        createEdgeConfigMock({
          isInMaintenanceMode: true,
        })
      );

      const req = createTestRequest({
        url: `${WEBAPP_URL}/api/bookings`,
      });

      const res = await callProxy(req);
      expect(res).toBeDefined();
      expectStatus(res, 200);
    });
  });

  describe("Signup Control", () => {
    it("should block signup when disabled", async () => {
      (edgeConfigGet as Mock).mockImplementation(
        createEdgeConfigMock({
          isSignupDisabled: true,
        })
      );

      const req = createTestRequest({
        url: `${WEBAPP_URL}/api/auth/signup`,
        method: "POST",
      });

      const res = await callProxy(req);
      expectStatus(res, 503);

      const body = await res.text();
      expect(body).toContain("Signup is disabled");
    });

    it("should allow signup when enabled", async () => {
      (edgeConfigGet as Mock).mockImplementation(
        createEdgeConfigMock({
          isSignupDisabled: false,
        })
      );

      const req = createTestRequest({
        url: `${WEBAPP_URL}/api/auth/signup`,
        method: "POST",
      });

      const res = await callProxy(req);
      expectStatus(res, 200);
    });
  });

  describe("Cookie Management", () => {
    it("should handle return-to cookie redirect", async () => {
      const returnUrl = "/dashboard";
      const req = createTestRequest({
        url: `${WEBAPP_URL}/apps/installed`,
        cookies: { "return-to": returnUrl },
      });

      const res = await callProxy(req);
      expectStatus(res, 307);
      expect(getHeader(res, "location")).toContain(returnUrl);
    });

    it("should not redirect without return-to cookie", async () => {
      const req = createTestRequest({
        url: `${WEBAPP_URL}/apps/installed`,
      });

      const res = await callProxy(req);
      expectStatus(res, 200);
    });

    it("should delete session cookie on logout", async () => {
      const req = createTestRequest({
        url: `${WEBAPP_URL}/auth/logout`,
      });

      const res = await callProxy(req);
      const setCookie = getHeader(res, "set-cookie");

      if (setCookie) {
        expect(setCookie).toContain("next-auth.session-token");
      }
    });
  });

  describe("Embed Routes", () => {
    it("should add embed headers", async () => {
      const req = createTestRequest({
        url: `${WEBAPP_URL}/team/test/embed`,
      });

      const res = await callProxy(req);
      expect(getHeader(res, "x-isEmbed")).toBe("true");
    });

    it("should add COEP header when requested", async () => {
      const req = createTestRequest({
        url: `${WEBAPP_URL}/team/test/embed?flag.coep=true`,
      });

      const res = await callProxy(req);
      expect(getHeader(res, "Cross-Origin-Embedder-Policy")).toBe("require-corp");
    });

    it("should add color scheme header", async () => {
      const req = createTestRequest({
        url: `${WEBAPP_URL}/team/test/embed?ui.color-scheme=dark`,
      });

      const res = await callProxy(req);
      expect(getHeader(res, "x-embedColorScheme")).toBe("dark");
    });
  });

  describe("CSP Headers", () => {
    beforeEach(() => {
      vi.stubEnv("CSP_POLICY", "strict");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("should add CSP headers to login pages", async () => {
      const req = createTestRequest({
        url: `${WEBAPP_URL}/auth/login`,
      });

      const res = await callProxy(req);
      const cspHeader = getHeader(res, "content-security-policy");

      expect(cspHeader).toBeTruthy();
      expect(cspHeader).toContain("default-src");
      expect(cspHeader).toContain("script-src");
    });

    it("should not add CSP headers to non-login pages", async () => {
      const req = createTestRequest({
        url: `${WEBAPP_URL}/team/test`,
      });

      const res = await callProxy(req);
      const cspHeader = getHeader(res, "content-security-policy");

      expect(cspHeader).toBeNull();
    });

    it("should add x-csp-status when CSP_POLICY not set", async () => {
      vi.unstubAllEnvs();

      const req = createTestRequest({
        url: `${WEBAPP_URL}/auth/login`,
      });

      const res = await callProxy(req);
      expect(getHeader(res, "x-csp-status")).toBe("not-opted-in");
    });
  });

  describe("Pathname header (TW-AWS-3)", () => {
    const forwardedHeaders = (spy: Mock) =>
      (spy.mock.calls.at(-1)?.[0] as { request?: { headers?: Headers } })?.request?.headers as Headers;

    it.each([
      "/team/awstreams/intro-call-ar",
      "/team/awstreams/intro-call-ar/embed",
    ])("forwards x-tw-pathname for %s so the root layout can set <html lang/dir>", async (path) => {
      const spy = vi.spyOn(NextResponse, "next");
      const res = await callProxy(createTestRequest({ url: `${WEBAPP_URL}${path}` }));
      expectStatus(res, 200);
      expect(forwardedHeaders(spy as unknown as Mock).get("x-tw-pathname")).toBe(path);
      spy.mockRestore();
    });

    it("overwrites a client-supplied x-tw-pathname", async () => {
      const spy = vi.spyOn(NextResponse, "next");
      await callProxy(
        createTestRequest({
          url: `${WEBAPP_URL}/team/awstreams/intro-call`,
          headers: { "x-tw-pathname": "/team/awstreams/intro-call-ar" },
        })
      );
      expect(forwardedHeaders(spy as unknown as Mock).get("x-tw-pathname")).toBe(
        "/team/awstreams/intro-call"
      );
      spy.mockRestore();
    });
  });

  describe("Header sanitization", () => {
    it("sanitizes non-ASCII request header values to prevent Vercel Runtime Malformed Response Header", async () => {
      const spy = vi.spyOn(NextResponse, "next");

      const req = createTestRequest({
        url: `${WEBAPP_URL}/team/test`,
        // Next.js will translate request overrides into x-middleware-request-* headers internally
        headers: {
          "cf-region": "São Paulo", // contains non-ASCII "ã"
        },
      });

      const res = await callProxy(req);
      expectStatus(res, 200);

      // Assert that middleware forwarded sanitized ASCII-only value
      const initArg = (spy as unknown as Mock).mock.calls.at(-1)?.[0] as {
        request?: { headers?: Headers };
      };
      expect(initArg?.request?.headers).toBeDefined();

      const forwarded = initArg?.request?.headers as Headers;
      expect(forwarded.get("cf-region")).toBe("Sao Paulo");

      spy.mockRestore();
    });

    it("strips non-ASCII bytes in mojibake values (e.g., 'SÃ£o Paulo' -> 'So Paulo')", async () => {
      const spy = vi.spyOn(NextResponse, "next");

      const req = createTestRequest({
        url: `${WEBAPP_URL}/team/test`,
        headers: {
          "cf-region": "SÃ£o Paulo", // mojibake for "São Paulo"; includes non-ASCII bytes
        },
      });

      const res = await callProxy(req);
      expectStatus(res, 200);

      const initArg = (spy as unknown as Mock).mock.calls.at(-1)?.[0] as {
        request?: { headers?: Headers };
      };
      const forwarded = initArg?.request?.headers as Headers;
      expect(forwarded.get("cf-region")).toBe("So Paulo");

      spy.mockRestore();
    });
  });

  describe("Multiple Features", () => {
    it("should handle embed route with query params", async () => {
      const req = createTestRequest({
        url: `${WEBAPP_URL}/team/test/embed?ui.color-scheme=light`,
      });

      const res = await callProxy(req);
      expect(getHeader(res, "x-isEmbed")).toBe("true");
      expect(getHeader(res, "x-embedColorScheme")).toBe("light");
    });
  });

  describe("Error Handling", () => {
    it("should handle Edge Config errors gracefully", async () => {
      (edgeConfigGet as Mock).mockImplementation(() => {
        throw new Error("Config error");
      });

      const req = createTestRequest({
        url: `${WEBAPP_URL}/team/test`,
      });

      const res = await callProxy(req);
      expect(res).toBeDefined();
      expectStatus(res, 200);
    });

    it("should handle malformed URLs", async () => {
      const req = createTestRequest({
        url: `${WEBAPP_URL}//double-slash`,
      });

      const res = await callProxy(req);
      expect(res).toBeDefined();
    });
  });
});

describe("Custom host routing (WC-TW-12c2)", () => {
  const SECRET = "test-approve-secret";
  // host -> resolve answer: orgSlug for an ACTIVE row; null means the route answered 404
  // (pending_dns, failed, unknown host or a foreign slug, which the route itself decides).
  const rows = new Map<string, { org: string; members: string[]; teams: string[] } | null>();
  const fetchMock = vi.fn(async (input: URL | string) => {
    const url = new URL(input.toString());
    const row = rows.get(url.searchParams.get("host") ?? "");
    const users = url.searchParams.get("users")?.split(",") ?? [];
    const team = url.searchParams.get("team");
    const allowed =
      !!row && users.every((u) => row.members.includes(u)) && (!team || row.teams.includes(team));
    return allowed
      ? new Response(JSON.stringify({ orgSlug: row.org }), { status: 200 })
      : new Response(null, { status: 404 });
  });

  const hostRequest = (host: string, path: string) =>
    createTestRequest({ url: `https://${host}${path}`, headers: { host } });

  beforeEach(() => {
    vi.clearAllMocks();
    clearCustomHostCache();
    vi.stubEnv("NEXT_PUBLIC_WEBAPP_URL", WEBAPP_URL);
    vi.stubEnv("TW_CUSTOM_DOMAINS_ENABLED", "true");
    vi.stubEnv("TW_DOMAIN_APPROVE_SECRET", SECRET);
    vi.stubGlobal("fetch", fetchMock);
    rows.clear();
    rows.set("book.acme.com", { org: "acme", members: ["alice", "bob"], teams: ["sales"] });
    rows.set("book.globex.com", { org: "globex", members: ["mallory"], teams: ["ops"] });
    rows.set("pending.acme.com", null);
    rows.set("failed.acme.com", null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const expectNotFound = (res: Response) => {
    expectStatus(res, 404);
    expect(getHeader(res, "cache-control")).toBe("no-store");
    expect(getHeader(res, "x-middleware-rewrite")).toBeNull();
    expect(getHeader(res, "x-middleware-next")).toBeNull();
  };

  it("rewrites / on an active customer host to its org's booking page", async () => {
    const res = await callProxy(hostRequest("book.acme.com", "/?utm=x"));
    expectStatus(res, 200);
    const rewrite = new URL(getHeader(res, "x-middleware-rewrite") ?? "");
    expect(rewrite.pathname).toBe("/team/acme");
    expect(rewrite.searchParams.get("isOrgProfile")).toBe("1");
    expect(rewrite.searchParams.get("utm")).toBe("x");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/internal/custom-domain/resolve");
    expect(url.searchParams.get("host")).toBe("book.acme.com");
    expect((init.headers as Record<string, string>)["x-tw-domain-approve-secret"]).toBe(SECRET);
  });

  it("rewrites /embed on an active host to the org embed page", async () => {
    const res = await callProxy(hostRequest("book.acme.com:443", "/embed"));
    const rewrite = new URL(getHeader(res, "x-middleware-rewrite") ?? "");
    expect(rewrite.pathname).toBe("/team/acme/embed");
    expect(getHeader(res, "x-isEmbed")).toBe("true");
  });

  it("serves the host org's own user and team pages without rewriting", async () => {
    for (const path of ["/alice", "/alice/30min", "/alice+bob", "/team/sales"]) {
      const res = await callProxy(hostRequest("book.acme.com", path));
      expectStatus(res, 200);
      expect(getHeader(res, "x-middleware-next")).toBe("1");
      expect(getHeader(res, "x-middleware-rewrite")).toBeNull();
    }
  });

  it.each([
    "pending.acme.com",
    "failed.acme.com",
    "unknown.example.org",
  ])("returns 404 no-store for %s", async (host) => {
    expectNotFound(await callProxy(hostRequest(host, "/")));
    expectNotFound(await callProxy(hostRequest(host, "/alice")));
  });

  it("returns 404 for another org's user or team slug under a customer host", async () => {
    for (const path of ["/mallory", "/alice+mallory", "/mallory/30min", "/team/ops"]) {
      expectNotFound(await callProxy(hostRequest("book.acme.com", path)));
    }
  });

  it("returns 404 for app routes under a customer host without asking the resolver", async () => {
    for (const path of ["/settings/my-account", "/auth/login", "/api/internal/custom-domain/resolve"]) {
      expectNotFound(await callProxy(hostRequest("book.acme.com", path)));
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with 404 when the resolve call errors", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expectNotFound(await callProxy(hostRequest("book.acme.com", "/")));
  });

  it.each([
    "timeway.co",
    "acme.timeway.co",
    "localhost:3000",
    new URL(WEBAPP_URL).host,
  ])("passes %s through untouched on non-legacy paths", async (host) => {
    for (const path of ["/alice", "/", "/settings/my-account", "/api/bookings"]) {
      const res = await callProxy(hostRequest(host, path));
      expectStatus(res, 200);
      expect(getHeader(res, "x-middleware-next")).toBe("1");
      expect(getHeader(res, "x-middleware-rewrite")).toBeNull();
      expect(getHeader(res, "x-csp-status")).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flag off: timeway hosts behave exactly as with the flag on (and as before 12c2)", async () => {
    const snapshot = async () => {
      clearCustomHostCache();
      const out: Record<string, unknown>[] = [];
      for (const host of ["timeway.co", "acme.timeway.co", "localhost:3000"]) {
        for (const path of ["/team/sales", "/alice/embed", "/auth/logout", "/alice"]) {
          const res = await callProxy(hostRequest(host, path));
          out.push({ host, path, status: res.status, headers: Object.fromEntries(res.headers.entries()) });
        }
      }
      return out;
    };
    const flagOn = await snapshot();
    vi.stubEnv("TW_CUSTOM_DOMAINS_ENABLED", "false");
    const flagOff = await snapshot();
    expect(flagOff).toEqual(flagOn);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flag off: a non-timeway host gets 404 without a lookup", async () => {
    vi.stubEnv("TW_CUSTOM_DOMAINS_ENABLED", "false");
    expectNotFound(await callProxy(hostRequest("book.acme.com", "/")));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Middleware Matcher Configuration", () => {
  const matcher = config.matcher.filter((entry): entry is string => typeof entry === "string");

  it("should include all core middleware routes", () => {
    expect(matcher).toContain("/auth/login");
    expect(matcher).toContain("/auth/logout");
    expect(matcher).toContain("/api/auth/signup");
    expect(matcher).toContain("/apps/installed");
    expect(matcher).toContain("/availability");
    expect(matcher).toContain("/login");
    expect(matcher).toContain("/:path*/embed");
  });

  it("should have no duplicate entries", () => {
    const uniqueEntries = new Set(matcher);
    expect(uniqueEntries.size).toBe(matcher.length);
  });

  it("should not contain any /api/ routes except /api/auth/signup", () => {
    const apiRoutes = matcher.filter((entry) => entry.startsWith("/api/") && entry !== "/api/auth/signup");
    expect(apiRoutes).toEqual([]);
  });

  it("should only contain the expected reduced route set", () => {
    expect(matcher).toEqual([
      "/auth/login",
      "/login",
      "/apps/installed",
      "/auth/logout",
      "/:path*/embed",
      "/team/:path*",
      "/availability",
      "/api/auth/signup",
    ]);
  });

  it("adds exactly one non-string entry: the custom-host catch-all that excludes timeway hosts", () => {
    const objects = config.matcher.filter((entry) => typeof entry !== "string");
    expect(objects).toHaveLength(1);
    const [entry] = objects as { source: string; missing: { type: string; value: string }[] }[];
    const hostRe = new RegExp(`^${entry.missing[0].value}$`);
    expect(entry.missing[0].type).toBe("host");
    for (const host of ["timeway.co", "acme.timeway.co", "a.b.timeway.co", "localhost", "127.0.0.1"]) {
      expect(hostRe.test(host)).toBe(true);
    }
    for (const host of ["book.acme.com", "timeway.co.evil.com", "eviltimeway.co"]) {
      expect(hostRe.test(host)).toBe(false);
    }
  });
});
