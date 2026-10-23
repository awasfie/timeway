import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@calcom/lib/server/cronAuth";

import { TaskProcessor } from "../task-processor";

async function handler(request: NextRequest) {
  if (!isCronAuthorized(request, { allowApiKey: false, allowQueryParam: false })) {
    return new Response("Unauthorized", { status: 401 });
  }
  const processor = new TaskProcessor();
  await processor.processQueue();
  return NextResponse.json({ success: true });
}

export async function GET(request: NextRequest) {
  return await handler(request);
}

export async function POST(request: NextRequest) {
  return await handler(request);
}
