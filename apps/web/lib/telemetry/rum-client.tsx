"use client";

import { useEffect } from "react";
import { type Metric, onLCP } from "web-vitals";

// Browser half of POST /api/rum (WC-PE-12b3). web-vitals reports the final LCP once per page view;
// only {v, name, value} leaves the page, no identity, URL or UA.

export function lcpPayload(m: Pick<Metric, "name" | "value">): string | null {
  if (m.name !== "LCP" || !Number.isFinite(m.value) || m.value <= 0) return null;
  return JSON.stringify({ v: 1, name: "LCP", value: Math.round(m.value) });
}

export function sendLcp(m: Pick<Metric, "name" | "value">, url = "/api/rum"): boolean {
  const body = lcpPayload(m);
  if (!body) return false;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(url, body)) return true;
    }
    void fetch(url, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "content-type": "text/plain" },
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export function RumBeacon(): null {
  useEffect(() => {
    onLCP((m) => {
      sendLcp(m);
    });
  }, []);
  return null;
}
