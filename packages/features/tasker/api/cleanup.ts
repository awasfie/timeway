import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@calcom/lib/server/cronAuth";

import tasker from "..";

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request, { allowApiKey: false, allowQueryParam: false })) {
    return new Response("Unauthorized", { status: 401 });
  }
  await tasker.cleanup();
  return NextResponse.json({ success: true });
}
