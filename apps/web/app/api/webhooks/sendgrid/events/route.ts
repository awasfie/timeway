import process from "node:process";
import { normalizeSendgridEvents } from "@calcom/features/email-events/lib/normalizeSendgridEvents";
import {
  SENDGRID_SIGNATURE_HEADER,
  SENDGRID_TIMESTAMP_HEADER,
  verifySendgridSignature,
} from "@calcom/features/email-events/lib/verifySendgridSignature";
import { EmailEventRepository } from "@calcom/features/email-events/repositories/EmailEventRepository";
import logger from "@calcom/lib/logger";
import { prisma } from "@calcom/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const log = logger.getSubLogger({ prefix: ["sendgrid-events"] });

// SendGrid batches up to ~1 MB per POST; anything larger is not from SendGrid.
const MAX_BODY_BYTES = 2_000_000;

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ message: "Payload too large" }, { status: 413 });
  }

  const check = verifySendgridSignature({
    publicKey: process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY,
    signature: request.headers.get(SENDGRID_SIGNATURE_HEADER),
    timestamp: request.headers.get(SENDGRID_TIMESTAMP_HEADER),
    rawBody,
  });
  if (!check.ok) {
    log.warn("rejected", { reason: check.reason });
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const { rows, skipped } = normalizeSendgridEvents(payload);
  try {
    const inserted = await new EmailEventRepository(prisma).insertMany(rows);
    log.info("stored", { received: rows.length + skipped, inserted, skipped });
    return NextResponse.json({ inserted, skipped }, { status: 200 });
  } catch (error) {
    // 5xx makes SendGrid retry the batch; sgEventId uniqueness keeps the retry idempotent.
    log.error("store failed", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ message: "Store failed" }, { status: 500 });
  }
}
