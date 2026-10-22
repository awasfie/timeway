import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { CustomHostnameRepository } from "@calcom/features/customHostnames/repositories/CustomHostnameRepository";
import { isCustomDomainsEnabled } from "@calcom/lib/domainManager/customHostnames/service";
import { prisma } from "@calcom/prisma";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { SettingsLayoutProps } from "./SettingsLayoutAppDirClient";
import SettingsLayoutAppDirClient from "./SettingsLayoutAppDirClient";

export default async function SettingsLayoutAppDir(props: SettingsLayoutProps) {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  const userId = session?.user?.id;
  if (!userId) {
    return redirect("/auth/login");
  }

  const canManageCustomDomain =
    isCustomDomainsEnabled() && (await new CustomHostnameRepository(prisma).listAdminOrgIds(userId)).length > 0;

  return (
    <SettingsLayoutAppDirClient
      {...props}
      teamFeatures={{}}
      permissions={{
        canViewRoles: false,
        canViewOrganizationBilling: false,
        canUpdateOrganization: false,
        canManageCustomDomain,
      }}
    />
  );
}
