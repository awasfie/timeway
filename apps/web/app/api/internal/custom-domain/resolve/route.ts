import { createHash, timingSafeEqual } from "node:crypto";
import process from "node:process";
import { CustomHostResolverRepository } from "@calcom/features/customHostnames/repositories/CustomHostResolverRepository";
import { resolveCustomHost } from "@calcom/lib/domainManager/customHostnames/resolve";
import { APPROVE_SECRET_HEADER, isCustomDomainsEnabled } from "@calcom/lib/domainManager/customHostnames/service";
import { prisma } from "@calcom/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const digest = (value: string) => createHash("sha256").update(value).digest();

const empty = (status: number) =>
  new NextResponse(null, { status, headers: { "cache-control": "no-store" } });

/**
 * WC-TW-12c2: proxy.ts asks here (it must not load Prisma) whether a customer host is ACTIVE and
 * whether the requested user/team slugs are wholly that org's. 200 {orgSlug} or 404. Read-only.
 */
export async function GET(req: NextRequest) {
  if (!isCustomDomainsEnabled()) return empty(404);

  const expected = process.env.TW_DOMAIN_APPROVE_SECRET;
  if (!expected) return empty(503);
  const provided = req.headers.get(APPROVE_SECRET_HEADER);
  if (!provided) return empty(401);
  if (!timingSafeEqual(digest(provided), digest(expected))) return empty(403);

  const params = req.nextUrl.searchParams;
  const host = params.get("host");
  if (!host) return empty(400);
  const users = params.get("users")?.split(",").filter(Boolean).slice(0, 10);
  const team = params.get("team") ?? undefined;

  const result = await resolveCustomHost(new CustomHostResolverRepository(prisma), { host, users, team });
  if (!result.ok) return empty(404);
  return NextResponse.json({ orgSlug: result.orgSlug }, { headers: { "cache-control": "no-store" } });
}
