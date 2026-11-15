"use client";

import process from "node:process";
import { useEffect } from "react";
import { init } from "../../../vendor/analytics/src/index";

/** WC-DX-3c-2 pageviews on every route, including the marketing pages that have no session provider.
 * AnalyticsIdentify (inside Providers) identifies signed-in users; init() is idempotent. */
export function AnalyticsInit(): null {
  useEffect(() => {
    init({ key: process.env.NEXT_PUBLIC_POSTHOG_KEY, apiHost: "/ingest", product: "timeway" });
  }, []);
  return null;
}
