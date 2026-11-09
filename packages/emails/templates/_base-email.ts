import process from "node:process";
import dayjs from "@calcom/dayjs";
import { FeaturesRepository } from "@calcom/features/flags/features.repository";
import isSmsCalEmail from "@calcom/lib/isSmsCalEmail";
import { getServerErrorFromUnknown } from "@calcom/lib/server/getServerErrorFromUnknown";
import { serverConfig } from "@calcom/lib/serverConfig";
import { setTestEmail } from "@calcom/lib/testEmails";
import { prisma } from "@calcom/prisma";
import { decodeHTML } from "entities";
import { z } from "zod";
import { recipientDomains } from "../lib/maskRecipient";
import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";
import { withBookingUidSmtpApi } from "../lib/smtpApiHeaders";

type SentInfo = { messageId?: string; response?: string };

export default class BaseEmail {
  name = "";

  protected getTimezone() {
    return "";
  }

  protected getLocale(): string {
    return "";
  }

  protected getFormattedRecipientTime({ time, format }: { time: string; format: string }) {
    return dayjs(time).tz(this.getTimezone()).locale(this.getLocale()).format(format);
  }

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    return {};
  }
  public async sendEmail() {
    const featuresRepository = new FeaturesRepository(prisma);
    const emailsDisabled = await featuresRepository.checkIfFeatureIsEnabledGlobally("emails");
    /** If email kill switch exists and is active, we prevent emails being sent. */
    if (emailsDisabled) {
      console.warn("Skipped Sending Email due to active Kill Switch");
      return new Promise((r) => r("Skipped Sending Email due to active Kill Switch"));
    }

    if (process.env.INTEGRATION_TEST_MODE === "true") {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-expect-error
      setTestEmail(await this.getNodeMailerPayload());
      console.log(
        "Skipped Sending Email as process.env.NEXT_PUBLIC_UNIT_TESTS is set. Emails are available in globalThis.testEmails"
      );
      return new Promise((r) => r("Skipped sendEmail for Unit Tests"));
    }

    const payload = await this.getNodeMailerPayload();

    const from = "from" in payload ? (payload.from as string) : "";
    const to = "to" in payload ? (payload.to as string) : "";

    if (isSmsCalEmail(to)) {
      console.log(`Skipped Sending Email to faux email: ${to}`);
      return new Promise((r) => r(`Skipped Sending Email to faux email: ${to}`));
    }

    const sanitizedFrom = sanitizeDisplayName(from);
    const sanitizedTo = sanitizeDisplayName(to);

    const parseSubject = z.string().safeParse(payload?.subject);
    const payloadWithUnEscapedSubject = {
      headers: withBookingUidSmtpApi(this.getMailerOptions().headers, this.getBookingUid()),
      ...payload,
      ...{
        from: sanitizedFrom,
        to: sanitizedTo,
      },
      ...(parseSubject.success && { subject: decodeHTML(parseSubject.data) }),
    };
    const { createTransport } = await import("nodemailer");
    await new Promise<SentInfo | undefined>((resolve, reject) =>
      createTransport(this.getMailerOptions().transport).sendMail(
        payloadWithUnEscapedSubject,
        (_err, info) => {
          if (_err) {
            const err = getServerErrorFromUnknown(_err);
            this.printNodeMailerError(err);
            reject(err);
          } else {
            resolve(info);
          }
        }
      )
    )
      .then((info) => this.logSent(info, sanitizedTo))
      .catch((e) =>
        console.error(
          "sendEmail",
          `from: ${"from" in payloadWithUnEscapedSubject ? payloadWithUnEscapedSubject.from : ""}`,
          `subject: ${"subject" in payloadWithUnEscapedSubject ? payloadWithUnEscapedSubject.subject : ""}`,
          e
        )
      );
    return new Promise((resolve) => resolve("send mail async"));
  }
  protected getMailerOptions() {
    return {
      transport: serverConfig.transport,
      from: serverConfig.from,
      headers: serverConfig.headers,
    };
  }
  /** Booking uid when the template carries a calEvent; read-only, no template changes needed. */
  protected getBookingUid(): string | undefined {
    const uid = (this as { calEvent?: { uid?: unknown } }).calEvent?.uid;
    return typeof uid === "string" && uid.length > 0 ? uid : undefined;
  }
  /**
   * One structured line per sent email so a send can be proven by id (TW-MAIL-ID).
   * Logs template, booking uid, nodemailer messageId, SendGrid X-Message-Id (from the SMTP
   * "250 Ok: queued as <id>" reply) and recipient domain(s) only. No address, subject or body.
   */
  protected logSent(info: SentInfo | undefined, to: string): void {
    const clean = (v: string) => v.replace(/\s+/g, "");
    const messageId = typeof info?.messageId === "string" && info.messageId ? clean(info.messageId) : "-";
    const queued = typeof info?.response === "string" ? /queued as\s+(\S+)/i.exec(info.response) : null;
    const sgMessageId = queued?.[1] ? clean(queued[1]) : "-";
    console.log(
      `sendEmail ok template=${this.name || "-"} bookingUid=${this.getBookingUid() ?? "-"} messageId=${messageId} sgMessageId=${sgMessageId} toDomain=${recipientDomains(to)}`
    );
  }
  protected printNodeMailerError(error: Error): void {
    /** Don't clog the logs with unsent emails in E2E */
    if (process.env.NEXT_PUBLIC_IS_E2E) return;
    console.error(`${this.name}_ERROR`, error);
  }
}
