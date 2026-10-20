import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { handleWebhookScheduledTriggers } from "@calcom/features/webhooks/lib/handleWebhookScheduledTriggers";
import prisma from "@calcom/prisma";
import { isCronAuthorized } from "@calcom/lib/server/cronAuth";

async function postHandler(req: NextRequest) {
  if (!isCronAuthorized(req, { allowBearerSecret: false })) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  await handleWebhookScheduledTriggers(prisma);

  return NextResponse.json({ ok: true });
}

export const POST = defaultResponderForAppDir(postHandler);
