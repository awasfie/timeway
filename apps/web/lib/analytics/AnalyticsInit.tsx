"use client";

import process from "node:process";
import { useEffect } from "react";
import { init } from "../../../../vendor/analytics/src/index";

/** WC-DX-3c-2: init the vendored client (same-origin /ingest) on every page, booking pages included. */
export function AnalyticsInit() {
  useEffect(() => {
    init({ key: process.env.NEXT_PUBLIC_POSTHOG_KEY, apiHost: "/ingest", product: "timeway" });
  }, []);

  return null;
}
