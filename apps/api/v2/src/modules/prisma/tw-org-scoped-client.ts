import type { PrismaClient } from "@calcom/prisma/client";
import { twOrgContextExtension, withTwOrgTransactions } from "@calcom/prisma/extensions/tw-org-context";

/**
 * TW-T9.2b1: API v2 builds its own clients instead of using @calcom/prisma's, so they need
 * the same TW-T9.2a extension for TwOrgScopeInterceptor's scope to reach the database.
 * With no scope the extension is a pass-through.
 */
export function withTwOrgScope(client: PrismaClient): PrismaClient {
  return withTwOrgTransactions(client.$extends(twOrgContextExtension())) as unknown as PrismaClient;
}
