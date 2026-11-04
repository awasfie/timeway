import { generateOrgLandingMetadata, OrgLandingPage } from "@lib/team/[slug]/orgLandingPage";

// WC-TW-12f: target of the custom-host and org-subdomain root rewrites (/team/<orgSlug>?isOrgProfile=1).
export const generateMetadata = generateOrgLandingMetadata;

export default OrgLandingPage;
