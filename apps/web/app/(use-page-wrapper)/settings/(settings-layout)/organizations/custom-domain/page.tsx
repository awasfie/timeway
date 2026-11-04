import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { CustomHostnameRepository } from "@calcom/features/customHostnames/repositories/CustomHostnameRepository";
import SettingsHeader from "@calcom/features/settings/appDir/SettingsHeader";
import { isCustomDomainsEnabled } from "@calcom/lib/domainManager/customHostnames/service";
import { prisma } from "@calcom/prisma";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { _generateMetadata, getTranslate } from "app/_utils";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import CustomDomainView from "~/settings/organizations/custom-domain-view";

export const generateMetadata = async () =>
  await _generateMetadata(
    (t) => t("custom_domain"),
    (t) => t("custom_domain_description"),
    undefined,
    undefined,
    "/settings/organizations/custom-domain"
  );

const Page = async () => {
  if (!isCustomDomainsEnabled()) notFound();

  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  const userId = session?.user?.id;
  if (!userId) redirect("/auth/login");

  // The router re-checks owner/admin on every call; this only picks the org to manage.
  const [orgId] = await new CustomHostnameRepository(prisma).listAdminOrgIds(userId);
  if (!orgId) notFound();

  const t = await getTranslate();
  return (
    <SettingsHeader
      title={t("custom_domain")}
      description={t("custom_domain_description")}
      borderInShellHeader={true}>
      <CustomDomainView orgId={orgId} />
    </SettingsHeader>
  );
};

export default Page;
