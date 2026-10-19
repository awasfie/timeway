import { createHash, timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CustomHostnameRepository } from "@calcom/lib/domainManager/customHostnames/repository";
import { createFixedWindowLimiter } from "@calcom/lib/domainManager/customHostnames/rateLimit";
import {
  APPROVE_SECRET_HEADER,
  isCustomDomainsEnabled,
  isHostnameApproved,
} from "@calcom/lib/domainManager/customHostnames/service";
import { prisma } from "@calcom/prisma";

const limiter = createFixedWindowLimiter({ limit: 600, windowMs: 60_000 });

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function secretMatches(provided: string, expected: string) {
  return timingSafeEqual(digest(provided), digest(expected));
}

function callerKey(req: NextRequest) {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip")) || "unknown";
}

const empty = (status: number) => new NextResponse(null, { status, headers: { "cache-control": "no-store" } });

/**
 * WC-TW-12b R4: the proxy's on-demand TLS `ask` hook.
 * 200 = issue a cert for ?domain=, anything else = refuse. Never writes, never lists.
 */
export async function GET(req: NextRequest) {
  if (!isCustomDomainsEnabled()) return empty(404);

  const expected = process.env.TW_DOMAIN_APPROVE_SECRET;
  if (!expected) return empty(503);

  const provided = req.headers.get(APPROVE_SECRET_HEADER);
  if (!provided) return empty(401);
  if (!secretMatches(provided, expected)) return empty(403);

  if (!limiter(callerKey(req))) return empty(429);

  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) return empty(400);

  const approved = await isHostnameApproved(new CustomHostnameRepository(prisma), domain);
  return empty(approved ? 200 : 404);
}
