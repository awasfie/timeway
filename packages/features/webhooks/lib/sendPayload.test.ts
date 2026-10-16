import { createHmac } from "node:crypto";
import { generateSecret } from "@family/webhooks";
import { Webhook } from "standardwebhooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookVersion } from "./interface/IWebhookRepository";
import sendPayload from "./sendPayload";

describe("sendPayload", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  describe("X-Cal-Webhook-Version header", () => {
    it("should include X-Cal-Webhook-Version header with the webhook version", async () => {
      const webhook = {
        subscriberUrl: "https://example.com/webhook",
        appId: null,
        payloadTemplate: null,
        version: WebhookVersion.V_2021_10_20,
      };

      await sendPayload("test-secret", "BOOKING_CREATED", new Date().toISOString(), webhook, {
        title: "Test Booking",
        startTime: "2024-01-01T10:00:00Z",
        endTime: "2024-01-01T11:00:00Z",
        organizer: {
          email: "organizer@example.com",
          name: "Organizer",
          timeZone: "UTC",
          language: { locale: "en" },
        },
        attendees: [],
        type: "test-event",
        description: "",
      } as unknown as Parameters<typeof sendPayload>[4]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];

      expect(url).toBe("https://example.com/webhook");
      expect(options.headers).toHaveProperty("X-Cal-Webhook-Version", "2021-10-20");
    });

    it("should include X-Cal-Signature-256 header alongside version header", async () => {
      const webhook = {
        subscriberUrl: "https://example.com/webhook",
        appId: null,
        payloadTemplate: null,
        version: WebhookVersion.V_2021_10_20,
      };

      await sendPayload("test-secret", "BOOKING_CREATED", new Date().toISOString(), webhook, {
        title: "Test Booking",
        startTime: "2024-01-01T10:00:00Z",
        endTime: "2024-01-01T11:00:00Z",
        organizer: {
          email: "organizer@example.com",
          name: "Organizer",
          timeZone: "UTC",
          language: { locale: "en" },
        },
        attendees: [],
        type: "test-event",
        description: "",
      } as unknown as Parameters<typeof sendPayload>[4]);

      const [, options] = mockFetch.mock.calls[0];

      expect(options.headers).toHaveProperty("X-Cal-Signature-256");
      expect(options.headers).toHaveProperty("X-Cal-Webhook-Version");
      expect(options.headers).toHaveProperty("Content-Type", "application/json");
    });

    it("should send correct version for different webhook versions", async () => {
      // Test with the current version
      const webhook = {
        subscriberUrl: "https://example.com/webhook",
        appId: null,
        payloadTemplate: null,
        version: WebhookVersion.V_2021_10_20,
      };

      await sendPayload("test-secret", "BOOKING_CREATED", new Date().toISOString(), webhook, {
        title: "Test",
        startTime: "2024-01-01T10:00:00Z",
        endTime: "2024-01-01T11:00:00Z",
        organizer: {
          email: "test@example.com",
          name: "Test",
          timeZone: "UTC",
          language: { locale: "en" },
        },
        attendees: [],
        type: "test",
        description: "",
      } as unknown as Parameters<typeof sendPayload>[4]);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers["X-Cal-Webhook-Version"]).toBe("2021-10-20");
    });
  });

  describe("Standard Webhooks headers (INT-2)", () => {
    const webhook = {
      subscriberUrl: "https://example.com/webhook",
      appId: null,
      payloadTemplate: null,
      version: WebhookVersion.V_2021_10_20,
    };
    const data = {
      title: "Test Booking",
      startTime: "2024-01-01T10:00:00Z",
      endTime: "2024-01-01T11:00:00Z",
      organizer: {
        email: "organizer@example.com",
        name: "Organizer",
        timeZone: "UTC",
        language: { locale: "en" },
      },
      attendees: [],
      type: "test-event",
      description: "",
    } as unknown as Parameters<typeof sendPayload>[4];

    it("signs a whsec_ subscriber's delivery so the reference verifier accepts it, legacy header unchanged", async () => {
      const secret = generateSecret();
      await sendPayload(secret, "BOOKING_CREATED", new Date().toISOString(), webhook, data);

      const [, options] = mockFetch.mock.calls[0];
      const verified = new Webhook(secret).verify(options.body, options.headers);
      expect(verified).toMatchObject({ triggerEvent: "BOOKING_CREATED" });
      const legacy = createHmac("sha256", secret).update(options.body).digest("hex");
      expect(options.headers["X-Cal-Signature-256"]).toBe(legacy);
    });

    it("sends no webhook-* headers to a non-whsec_ subscriber", async () => {
      await sendPayload("test-secret", "BOOKING_CREATED", new Date().toISOString(), webhook, data);

      const [, options] = mockFetch.mock.calls[0];
      expect(Object.keys(options.headers).filter((h) => h.startsWith("webhook-"))).toEqual([]);
      const legacy = createHmac("sha256", "test-secret").update(options.body).digest("hex");
      expect(options.headers["X-Cal-Signature-256"]).toBe(legacy);
    });
  });
});
