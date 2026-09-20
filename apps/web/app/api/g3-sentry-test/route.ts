import { NextResponse } from "next/server";

/**
 * G-3/OB-T1 observability verification only. Throws a synthetic error so
 * Sentry ingestion can be confirmed end-to-end on the real deployed
 * timeway.co instance, matching the convention already used on
 * salesos-api/workers (see salesos docs/ops-log.md "G3TestError"
 * entries). Gated by a shared secret so this isn't a free
 * crash-on-demand surface for anyone who finds it.
 */
export async function GET(request: Request) {
  const secret = request.headers.get("x-g3-test-secret");
  if (secret !== process.env.G3_TEST_SECRET) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  throw new Error(`G3-LIVE-TEST-timeway-sentry-verification-${Date.now()}`);
}
