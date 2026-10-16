import { createHmac } from "node:crypto";
import { generateSecret } from "@family/webhooks";
import { Webhook } from "standardwebhooks";
import { describe, expect, it, vi } from "vitest";
import { createWebhookHeaders, createWebhookSignature } from "./webhookSignature";

const body = JSON.stringify({ triggerEvent: "BOOKING_CREATED", payload: { uid: "b_1" } });

describe("createWebhookHeaders", () => {
  it("returns only X-Cal-Signature-256 for a non-whsec_ secret (today's behaviour)", () => {
    const headers = createWebhookHeaders({ secret: "plain-secret", body });
    expect(headers).toEqual({
      "X-Cal-Signature-256": createHmac("sha256", "plain-secret").update(body).digest("hex"),
    });
  });

  it("returns no-secret-provided and no Standard headers without a secret", () => {
    expect(createWebhookHeaders({ secret: null, body })).toEqual({
      "X-Cal-Signature-256": "no-secret-provided",
    });
  });

  it("adds Standard Webhooks headers for a whsec_ secret; legacy HMAC over the same secret string", () => {
    const secret = generateSecret();
    const headers = createWebhookHeaders({ secret, body });

    expect(headers["X-Cal-Signature-256"]).toBe(createWebhookSignature({ secret, body }));
    expect(headers["webhook-id"]).toMatch(/^msg_/);
    expect(headers["webhook-signature"]).toMatch(/^v1,/);
    expect(new Webhook(secret).verify(body, headers)).toEqual(JSON.parse(body));
  });

  it("is rejected by the reference verifier when the body is altered or the secret differs", () => {
    const secret = generateSecret();
    const headers = createWebhookHeaders({ secret, body });

    expect(() => new Webhook(secret).verify(`${body} `, headers)).toThrow();
    expect(() => new Webhook(generateSecret()).verify(body, headers)).toThrow();
  });

  it("keeps the legacy header and skips Standard headers when a whsec_ secret is malformed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const headers = createWebhookHeaders({ secret: "whsec_tooShort", body });

    expect(Object.keys(headers)).toEqual(["X-Cal-Signature-256"]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
