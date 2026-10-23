import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();

vi.mock("nodemailer", () => ({
  createTransport: vi.fn(() => ({ sendMail })),
}));

vi.mock("@calcom/prisma", () => ({
  prisma: {},
}));

vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class {
    checkIfFeatureIsEnabledGlobally() {
      return Promise.resolve(false);
    }
  },
}));

vi.mock("@calcom/lib/serverConfig", () => ({
  serverConfig: { transport: {}, from: "Timeway <noreply@timeway.co>", headers: {} },
}));

import process from "node:process";
import BaseEmail from "./_base-email";

class TestEmail extends BaseEmail {
  constructor(private readonly to: string) {
    super();
    this.name = "TEST_EMAIL";
  }

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    return {
      from: "Timeway <noreply@timeway.co>",
      to: this.to,
      subject: "Booking confirmed",
      html: "<p>secret body content</p>",
    };
  }
}

/** Mirrors the booking templates (AttendeeScheduledEmail etc.), which expose `calEvent`. */
class TestBookingEmail extends TestEmail {
  calEvent: { uid?: string | null };
  constructor(to: string, uid: string | null) {
    super(to);
    this.name = "SEND_BOOKING_CONFIRMATION";
    this.calEvent = { uid };
  }
}

describe("BaseEmail.sendEmail logging", () => {
  const originalMode = process.env.INTEGRATION_TEST_MODE;
  let log: MockInstance<typeof console.log>;
  let error: MockInstance<typeof console.error>;
  const okLines = () => log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("sendEmail ok "));

  beforeEach(() => {
    delete process.env.INTEGRATION_TEST_MODE;
    sendMail.mockReset();
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.INTEGRATION_TEST_MODE = originalMode;
    vi.restoreAllMocks();
  });

  it("logs one structured line with template, booking uid, messageId, SendGrid id and recipient domain", async () => {
    sendMail.mockImplementation((_payload, cb) =>
      cb(null, { messageId: "<abc@timeway.co>", response: "250 Ok: queued as SgXmsgId_123.filter" })
    );

    const result = await new TestBookingEmail("ahmedwasfie@AWstreams.com", "bk_uid_42").sendEmail();

    expect(result).toBe("send mail async");
    expect(okLines()).toEqual([
      "sendEmail ok template=SEND_BOOKING_CONFIRMATION bookingUid=bk_uid_42 messageId=<abc@timeway.co> sgMessageId=SgXmsgId_123.filter toDomain=awstreams.com",
    ]);
    expect(error).not.toHaveBeenCalled();
  });

  it("never logs the address local part, subject or body", async () => {
    sendMail.mockImplementation((_payload, cb) =>
      cb(null, { messageId: "<abc@timeway.co>", response: "250 Ok: queued as XYZ" })
    );

    await new TestBookingEmail('"Ahmed W" <ahmedwasfie@awstreams.com>, bob@x.io', "bk_1").sendEmail();

    const all = log.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(all).not.toContain("ahmedwasfie");
    expect(all).not.toContain("bob@");
    expect(all).not.toContain("Booking confirmed");
    expect(all).not.toContain("secret body content");
    expect(okLines()[0]).toContain("toDomain=awstreams.com,x.io");
  });

  it("uses '-' for a non-booking email, a missing SendGrid id and a missing messageId", async () => {
    sendMail.mockImplementation((_payload, cb) => cb(null, { response: "250 2.0.0 OK" }));

    await new TestEmail("bo@example.com").sendEmail();

    expect(okLines()).toEqual([
      "sendEmail ok template=TEST_EMAIL bookingUid=- messageId=- sgMessageId=- toDomain=example.com",
    ]);
  });

  it("uses '-' for a booking email whose calEvent has no uid", async () => {
    sendMail.mockImplementation((_payload, cb) => cb(null, { messageId: "<id@x>" }));

    await new TestBookingEmail("bo@example.com", null).sendEmail();

    expect(okLines()[0]).toContain("bookingUid=- messageId=<id@x> sgMessageId=-");
  });

  it("keeps the error path: logs sendEmail error, no ok line", async () => {
    sendMail.mockImplementation((_payload, cb) => cb(new Error("SMTP down"), undefined));

    const result = await new TestEmail("ahmedwasfie@awstreams.com").sendEmail();

    expect(result).toBe("send mail async");
    expect(error.mock.calls.some((c) => c[0] === "sendEmail")).toBe(true);
    expect(okLines()).toEqual([]);
  });

  it("keeps the faux-email skip path unchanged", async () => {
    const result = await new TestEmail("+155****1111@sms.cal.com").sendEmail();

    expect(result).toBe("Skipped Sending Email to faux email: +155****1111@sms.cal.com");
    expect(sendMail).not.toHaveBeenCalled();
  });
});
