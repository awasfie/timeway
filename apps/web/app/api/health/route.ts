import { prisma } from "@calcom/prisma";
import { NextResponse } from "next/server";

// DEPLOY-1 (t_feaa2d69): Coolify healthcheck target. 200 only when the app can reach Postgres;
// 503 otherwise, so a rolling update never stops the old container for a not-ready new one.
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
