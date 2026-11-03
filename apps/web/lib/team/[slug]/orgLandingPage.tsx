import { OrgLandingRepository } from "@calcom/features/customHostnames/repositories/OrgLandingRepository";
import { loadOrgLanding } from "@calcom/lib/domainManager/customHostnames/orgLanding";
import { prisma } from "@calcom/prisma";
import type { PageProps } from "app/_types";
import { getTranslate } from "app/_utils";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import OrgLandingView from "~/team/org-landing-view";

/**
 * WC-TW-12f: /team/<orgSlug> renders the Timeway org's landing page. Cal.diy removed the upstream
 * team page (ab21c7f805), so the custom-host "/" rewrite (hostRouting.orgRootRewritePath) and the
 * org-subdomain rewrite in next.config.ts had no page. Unknown or inactive slug -> 404.
 */
const getLanding = cache(async (slug: string) => loadOrgLanding(new OrgLandingRepository(prisma), slug));

async function slugFrom(params: PageProps["params"]) {
  const value = (await params)?.slug;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

export async function generateOrgLandingMetadata({ params }: PageProps): Promise<Metadata> {
  const landing = await getLanding(await slugFrom(params));
  if (!landing) return { robots: { index: false, follow: false } };
  return { title: landing.org.name, robots: { index: false, follow: true } };
}

export async function OrgLandingPage({ params }: PageProps) {
  const landing = await getLanding(await slugFrom(params));
  if (!landing) notFound();
  const t = await getTranslate();
  return <OrgLandingView landing={landing} t={t} />;
}
