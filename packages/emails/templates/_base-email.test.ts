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

  it("logs the transport messageId with a masked recipient on success", async () => {
    sendMail.mockImplementation((_payload, cb) =>
      cb(null, { messageId: "<abc@x>", response: "250 Ok: queued as XYZ" })
    );

    const result = await new TestEmail("ahmedwasfie@awstreams.com").sendEmail();

    expect(result).toBe("send mail async");
    const [okLine] = okLines();
    expect(okLine).toBe(
      "sendEmail ok messageId=<abc@x> to=ah***@awstreams.com subject=Booking confirmed response=250 Ok: queued as XYZ"
    );
    expect(okLine).not.toContain("ahmedwasfie");
    expect(okLine).not.toContain("secret body content");
    expect(error).not.toHaveBeenCalled();
  });

  it("truncates the transport response to 80 chars", async () => {
    sendMail.mockImplementation((_payload, cb) =>
      cb(null, { messageId: "<id@x>", response: "x".repeat(200) })
    );

    await new TestEmail("bo@example.com").sendEmail();

    const [okLine] = okLines();
    expect(okLine).toContain("to=bo***@example.com");
    expect(okLine?.endsWith(`response=${"x".repeat(80)}`)).toBe(true);
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
