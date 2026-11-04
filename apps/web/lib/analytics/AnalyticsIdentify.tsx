"use client";

import process from "node:process";
import { toAnalyticsLocale } from "@calcom/lib/analytics/locale";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { identify, init } from "../../../../vendor/analytics/src/index";
import { useGeo } from "../../app/GeoContext";

/** WC-DX-3c-2: init the vendored client (same-origin /ingest) and identify after the session loads. */
export function AnalyticsIdentify() {
  const { data: session, status } = useSession();
  const { country } = useGeo();

  useEffect(() => {
    init({ key: process.env.NEXT_PUBLIC_POSTHOG_KEY, apiHost: "/ingest", product: "timeway" });
  }, []);

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
