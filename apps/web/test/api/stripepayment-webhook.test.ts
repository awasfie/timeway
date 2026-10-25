import { Readable } from "node:stream";
import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handleStripeWebhook = vi.fn();
vi.mock("@calcom/app-store/stripepayment/lib/webhook", () => ({
  handleStripeWebhook: (input: unknown) => handleStripeWebhook(input),
}));

import handler from "../../pages/api/integrations/stripepayment/webhook";

function makeReq(body: Buffer, headers: Record<string, string> = {}): NextApiRequest {
  const stream = Readable.from([body]) as unknown as NextApiRequest;
  Object.assign(stream, { method: "POST", headers: { "stripe-signature": "t=1,v1=sig", ...headers } });
  return stream;
}

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
  };
  return res;
}

describe("POST /api/integrations/stripepayment/webhook body limit", () => {
  beforeEach(() => {
    handleStripeWebhook.mockReset();
    handleStripeWebhook.mockResolvedValue({ outcome: "ignored_event", httpStatus: 200 });
  });

  it("passes a normal body to the signature check", async () => {
    const body = Buffer.from(JSON.stringify({ id: "evt_1", type: "customer.created" }));
    const res = makeRes();
    await handler(makeReq(body), res as unknown as NextApiResponse);
    expect(res.statusCode).toBe(200);
    expect(handleStripeWebhook).toHaveBeenCalledTimes(1);
    expect(handleStripeWebhook.mock.calls[0][0]).toMatchObject({ signature: "t=1,v1=sig" });
    expect(Buffer.compare(handleStripeWebhook.mock.calls[0][0].rawBody, body)).toBe(0);
  });

  it("rejects a streamed body over 1mb with 413 before the signature check", async () => {
    const res = makeRes();
    await handler(makeReq(Buffer.alloc(1024 * 1024 + 1, "a")), res as unknown as NextApiResponse);
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ received: false, outcome: "body_too_large" });
    expect(handleStripeWebhook).not.toHaveBeenCalled();
  });

  it("rejects a declared content-length over 1mb with 413 without reading it", async () => {
    const res = makeRes();
    await handler(
      makeReq(Buffer.from("{}"), { "content-length": String(5 * 1024 * 1024) }),
      res as unknown as NextApiResponse
    );
    expect(res.statusCode).toBe(413);
    expect(handleStripeWebhook).not.toHaveBeenCalled();
  });

  it("accepts a body of exactly 1mb", async () => {
    const res = makeRes();
    await handler(makeReq(Buffer.alloc(1024 * 1024, "a")), res as unknown as NextApiResponse);
    expect(res.statusCode).toBe(200);
    expect(handleStripeWebhook).toHaveBeenCalledTimes(1);
  });
});
