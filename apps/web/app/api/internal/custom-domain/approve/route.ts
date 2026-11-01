import { createHash, timingSafeEqual } from "node:crypto";
import process from "node:process";
import { CustomHostnameRepository } from "@calcom/features/customHostnames/repositories/CustomHostnameRepository";
import { createFixedWindowLimiter } from "@calcom/lib/domainManager/customHostnames/rateLimit";
import {
  APPROVE_SECRET_HEADER,
  isCustomDomainsEnabled,
  isHostnameApproved,
} from "@calcom/lib/domainManager/customHostnames/service";
import { withTwPlatformJob } from "@calcom/lib/server/tw-org-scope/unattended";
import { prisma } from "@calcom/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const limiter = createFixedWindowLimiter({ limit: 600, windowMs: 60_000 });

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function secretMatches(provided: string, expected: string) {
  return timingSafeEqual(digest(provided), digest(expected));
}

// The first x-forwarded-for entry is client-supplied; x-real-ip and the last XFF hop are set by our proxy.
function callerKey(req: NextRequest) {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const hops = req.headers.get("x-forwarded-for")?.split(",") ?? [];
  return hops[hops.length - 1]?.trim() || "unknown";
}

const empty = (status: number) =>
  new NextResponse(null, { status, headers: { "cache-control": "no-store" } });

/**
 * WC-TW-12b R4: the proxy's on-demand TLS `ask` hook.
 * 200 = issue a cert for ?domain=, anything else = refuse. Never writes, never lists.
 */
async function handler(req: NextRequest) {
  if (!isCustomDomainsEnabled()) return empty(404);

  const expected = process.env.TW_DOMAIN_APPROVE_SECRET;
  if (!expected) return empty(503);

  // Limit before the secret check so wrong-secret guesses are throttled too.
  if (!limiter(callerKey(req))) return empty(429);

  const provided = req.headers.get(APPROVE_SECRET_HEADER);
  if (!provided) return empty(401);
  if (!secretMatches(provided, expected)) return empty(403);

  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) return empty(400);

  const approved = await isHostnameApproved(new CustomHostnameRepository(prisma), domain);
  return empty(approved ? 200 : 404);
}

// TW-T9.2b4: secret-gated, reads across orgs, so it runs under a named platform scope.
export const GET = withTwPlatformJob("custom-domain-approve", handler);
