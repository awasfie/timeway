import { getAvailableSlotsService } from "@calcom/features/di/containers/AvailableSlots";
import type { OrgApiClient } from "@calcom/features/tw-provisioning/orgApi";
import { handleOrgApi } from "@calcom/features/tw-provisioning/orgApi";
import { prisma } from "@calcom/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * TW-T10: provisioning + org API (CC-14). Thin adapter over handleOrgApi; auth, scoping and
 * idempotency live in packages/features/tw-provisioning. Never cached.
 */
async function handle(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = await params;
  let body: unknown;
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "body must be JSON" } },
        { status: 400, headers: { "cache-control": "no-store" } }
      );
    }
  }
  const res = await handleOrgApi(
    {
      method: req.method,
      path: path ?? [],
      authorization: req.headers.get("authorization"),
      query: req.nextUrl.searchParams,
      body,
    },
    {
      client: prisma as unknown as OrgApiClient,
      getSlots: (input) =>
        getAvailableSlotsService().getAvailableSlots({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ctx: { req: undefined } as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          input: { ...input, isTeamEvent: false, orgSlug: null } as any,
        }),
    }
  );
  return NextResponse.json(res.body, { status: res.status, headers: { "cache-control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
