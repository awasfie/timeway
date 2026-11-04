import { OrgLandingPage } from "@lib/team/[slug]/orgLandingPage";
import type { PageProps } from "app/_types";
import type { Metadata } from "next";

// WC-TW-12f: "/embed" on a custom host rewrites here; without this static segment it would hit [type].
export const generateMetadata = async (): Promise<Metadata> => ({ robots: { index: false, follow: false } });

export default async function OrgLandingEmbedPage(props: PageProps) {
  return OrgLandingPage(props);
}
