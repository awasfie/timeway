"use client";

import { toAnalyticsLocale } from "@calcom/lib/analytics/locale";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { identify } from "../../../../vendor/analytics/src/index";
import { useGeo } from "../../app/GeoContext";

/**
 * WC-DX-3c-2: identify after the session loads. Mounted under AuthedAppProviders (WC-TW-6c-9b), so the public
 * booking route does not pull next-auth/react; AnalyticsInit in the root Providers does the init.
 */
export function AnalyticsIdentify() {
  const { data: session, status } = useSession();
  const { country } = useGeo();

  const user = session?.user;
  const userId = user?.uuid;
  const orgId = user?.profile?.organizationId ?? user?.org?.id;
  const locale = toAnalyticsLocale(user?.locale);

  useEffect(() => {
    if (status !== "authenticated" || !userId || !locale) return;
    identify(String(userId), {
      orgId: orgId ? String(orgId) : "",
      locale,
      country: country && country !== "Unknown" ? country : null,
    });
  }, [status, userId, orgId, locale, country]);

  return null;
}
