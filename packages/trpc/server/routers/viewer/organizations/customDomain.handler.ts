import { CustomHostnameRepository } from "@calcom/lib/domainManager/customHostnames/repository";
import { lookupCname, probeHttps } from "@calcom/lib/domainManager/customHostnames/probes";
import {
  CustomHostnameService,
  getCnameTarget,
  isCustomDomainsEnabled,
} from "@calcom/lib/domainManager/customHostnames/service";
import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import { TRPCError } from "@trpc/server";

import type { TCustomDomainAddInput, TCustomDomainOrgInput } from "./customDomain.schema";

type Ctx = { user: NonNullable<TrpcSessionUser> };

export type CustomDomainAction = "get" | "add" | "refresh" | "remove";

export type CustomDomainHandlerDeps = {
  repository: CustomHostnameRepository;
  service: CustomHostnameService;
};

function defaultDeps(): CustomDomainHandlerDeps {
  const repository = new CustomHostnameRepository(prisma);
  return { repository, service: new CustomHostnameService({ repository, lookupCname, probeHttps }) };
}

/**
 * Org admin gate: the org id in the input is only trusted after the session
 * user's own owner/admin membership of it is confirmed.
 */
export async function customDomainHandler(
  action: CustomDomainAction,
  { ctx, input }: { ctx: Ctx; input: TCustomDomainOrgInput | TCustomDomainAddInput },
  deps: CustomDomainHandlerDeps = defaultDeps()
) {
  if (!isCustomDomainsEnabled()) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Custom domains are not enabled" });
  }
  const adminOrgIds = await deps.repository.listAdminOrgIds(ctx.user.id);
  if (!adminOrgIds.includes(input.orgId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Organization admin only" });
  }

  const { service } = deps;
  switch (action) {
    case "get":
      return { hostname: await service.get(input.orgId), cnameTarget: getCnameTarget() };
    case "add":
      return {
        hostname: await service.addHostname(input.orgId, (input as TCustomDomainAddInput).hostname),
        cnameTarget: getCnameTarget(),
      };
    case "refresh":
      return { hostname: await service.refresh(input.orgId), cnameTarget: getCnameTarget() };
    case "remove":
      return { removed: await service.remove(input.orgId) };
  }
}
