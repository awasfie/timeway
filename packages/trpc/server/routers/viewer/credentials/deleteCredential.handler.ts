import handleDeleteCredential from "@calcom/features/credentials/handleDeleteCredential";
import { RoleBasedPermissionCheckService } from "@calcom/features/membership/services/RoleBasedPermissionCheckService";
import { prisma } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import { TRPCError } from "@trpc/server";

import type { TDeleteCredentialInputSchema } from "./deleteCredential.schema";

type DeleteCredentialOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
  input: TDeleteCredentialInputSchema;
};

export const deleteCredentialHandler = async ({ ctx, input }: DeleteCredentialOptions) => {
  const { user } = ctx;
  const { id, teamId } = input;

  // handleDeleteCredential scopes the lookup to teamId when one is given, so the caller must administer it.
  if (teamId) {
    const isTeamAdmin = await new RoleBasedPermissionCheckService(prisma).checkPermission({
      userId: user.id,
      teamId,
      fallbackRoles: [MembershipRole.ADMIN, MembershipRole.OWNER],
    });
    if (!isTeamAdmin) throw new TRPCError({ code: "FORBIDDEN" });
  }

  await handleDeleteCredential({ userId: user.id, userMetadata: user.metadata, credentialId: id, teamId });
};
