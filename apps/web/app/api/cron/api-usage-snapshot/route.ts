import { enqueueManagedUserSnapshot } from "@calcom/features/payments/gateway/apiUsage";
import { isCronAuthorized } from "@calcom/lib/server/cronAuth";
import { defaultResponderForAppDir } from "@calcom/web/app/api/defaultResponderForAppDir";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * WC-TW-14c E6(a): daily managed-user snapshot, one line per billing org through the usage outbox.
 * Safe to run twice a day: the identifier is (UTC day, billing org). A no-op while TW_API_USAGE_ENABLED is off.
 */
async function getHandler(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }
  const result = await enqueueManagedUserSnapshot();
  return NextResponse.json(
    { ok: result.errors === 0, ...result },
    { status: result.errors === 0 ? 200 : 500 }
  );
}

export const GET = defaultResponderForAppDir(getHandler);
