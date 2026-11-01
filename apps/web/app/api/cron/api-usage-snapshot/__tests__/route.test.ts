import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const snapshot = vi.hoisted(() => vi.fn());
vi.mock("@calcom/features/payments/gateway/apiUsage", () => ({ enqueueManagedUserSnapshot: snapshot }));

import process from "node:process";
import { GET } from "../route";

const ctx = { params: Promise.resolve({}) };
const req = (headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/cron/api-usage-snapshot", { headers });

describe("api-usage-snapshot cron", () => {
  beforeEach(() => {
    snapshot.mockReset();
    vi.stubEnv("CRON_API_KEY", "k");
    process.env.CRON_SECRET = "k";
  });

  it("rejects an unauthenticated call without touching the outbox", async () => {
    const res = await GET(req(), ctx);
    expect(res.status).toBe(403);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("runs the snapshot when authorized", async () => {
    snapshot.mockResolvedValue({
      enabled: false,
      day: "2026-10-23",
      billingOrgs: 0,
      enqueued: 0,
      duplicate: 0,
      errors: 0,
    });
    const res = await GET(req({ authorization: "Bearer k" }), ctx);
    expect(res.status).toBe(200);
    expect(snapshot).toHaveBeenCalledTimes(1);
  });
});
