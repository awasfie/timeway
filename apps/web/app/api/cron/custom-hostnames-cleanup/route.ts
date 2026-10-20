import process from "node:process";
import { CustomHostnameRepository } from "@calcom/features/customHostnames/repositories/CustomHostnameRepository";
import { cleanupStaleHostnames } from "@calcom/lib/domainManager/customHostnames/service";
import { prisma } from "@calcom/prisma";
import { defaultResponderForAppDir } from "@calcom/web/app/api/defaultResponderForAppDir";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * WC-TW-12b R8: daily removal of custom hostnames never activated 48 h after creation.
 * Dry-run unless ?dryRun=false is passed explicitly.
 */
async function getHandler(request: NextRequest) {
  const apiKey = request.headers.get("authorization") || request.nextUrl.searchParams.get("apiKey");

  // Same contract as the other cron routes, minus the hole where an unset CRON_SECRET accepts "Bearer undefined".
  const accepted = [
    process.env.CRON_API_KEY,
    process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : undefined,
  ].filter((v): v is string => !!v);

  if (!apiKey || !accepted.includes(apiKey)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") !== "false";

  try {
    const result = await cleanupStaleHostnames(new CustomHostnameRepository(prisma), { dryRun });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error(`[custom-hostnames-cleanup] ${message}:`, e);
    return NextResponse.json({ message }, { status: 500 });
  }
}

export const GET = defaultResponderForAppDir(getHandler);
