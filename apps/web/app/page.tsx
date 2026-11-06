import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { checkOnboardingRedirect } from "@calcom/features/auth/lib/onboardingUtils";
import { APP_NAME } from "@calcom/lib/constants";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { _generateMetadataForStaticPage } from "app/_utils";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getFrontLocale } from "~/marketing/frontLocale";
import { LandingPage } from "~/marketing/LandingPage";
import { FROM_PRICE } from "~/marketing/plans";

// L8-6-TW (Bible v13 L.3 1a): signed-out visitors get the marketing page; signed-in users still go to the app.
export const generateMetadata = async (): Promise<Metadata> =>
  await _generateMetadataForStaticPage(
    "Online scheduling for the Gulf",
    `${APP_NAME} booking pages with two-way calendar sync, WhatsApp reminders and Arabic support. Plans from ${FROM_PRICE} per user a month.`,
    undefined,
    undefined,
    "/"
  );

const RedirectPage = async () => {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });

  if (!session?.user?.id) {
    return <LandingPage appName={APP_NAME} locale={await getFrontLocale()} />;
  }

  // Check if user needs onboarding and redirect before going to event-types
  const organizationId = session.user.profile?.organizationId ?? null;
  const onboardingPath = await checkOnboardingRedirect(session.user.id, {
    checkEmailVerification: true,
    organizationId,
  });
  if (onboardingPath) {
    redirect(onboardingPath);
  }

  redirect("/event-types");
};

export default RedirectPage;
