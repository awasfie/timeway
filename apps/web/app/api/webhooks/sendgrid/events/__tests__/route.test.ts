import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMany } = vi.hoisted(() => ({ createMany: vi.fn() }));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
  },
}));
vi.mock("@calcom/prisma", () => ({ prisma: { emailEvent: { createMany } } }));
vi.mock("@calcom/lib/logger", () => ({
  default: { getSubLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import process from "node:process";
import { POST } from "../route";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKeyB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");

function req(body: string, headers: Record<string, string>) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { text: async () => body, headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null } };
}

function signed(body: string, ts = String(Math.floor(Date.now() / 1000))) {
  return {
    "X-Twilio-Email-Event-Webhook-Timestamp": ts,
    "X-Twilio-Email-Event-Webhook-Signature": sign(
      "sha256",
      Buffer.from(ts + body, "utf8"),
      privateKey
    ).toString("base64"),
  };
}

type Res = { status: number; body: unknown };
const call = (r: ReturnType<typeof req>) =>
  POST(r as unknown as Parameters<typeof POST>[0]) as unknown as Promise<Res>;

describe("POST /api/webhooks/sendgrid/events", () => {
  beforeEach(() => {
    createMany.mockReset();
    createMany.mockResolvedValue({ count: 1 });
    process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY = publicKeyB64;
  });

  const body = JSON.stringify([
    { sg_event_id: "e1", event: "delivered", email: "x@example.com", timestamp: 1_792_600_000 },
    { sg_event_id: "e2", event: "click", timestamp: 1_792_600_000 },
  ]);

  it("401 when unsigned and never touches the DB", async () => {
    const res = await call(req(body, {}));
    expect(res.status).toBe(401);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("401 when the signature is stale", async () => {
    const res = await call(req(body, signed(body, String(Math.floor(Date.now() / 1000) - 600))));
    expect(res.status).toBe(401);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("401 when the key env is unset", async () => {
    delete process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY;
    const res = await call(req(body, signed(body)));
    expect(res.status).toBe(401);
  });

  it("stores ledger events with skipDuplicates on a good signature", async () => {
    const res = await call(req(body, signed(body)));
    expect(res).toEqual({ status: 200, body: { inserted: 1, skipped: 1 } });
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ sgEventId: "e1", recipientDomain: "example.com" })],
      skipDuplicates: true,
    });
  });

  it("500 on a DB failure so SendGrid retries", async () => {
    createMany.mockRejectedValueOnce(new Error("db down"));
    const res = await call(req(body, signed(body)));
    expect(res.status).toBe(500);
  });
});
