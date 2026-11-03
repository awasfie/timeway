import process from "node:process";

import logger from "./logger";

const log = logger.getSubLogger({ prefix: ["trackServerEvent"] });

export type ServerEventName =
  | "calendar_connected"
  | "event_type_published"
  | "first_external_booking"
  | "booking_confirmed";

/** Only non-identifying props (WC-TW-9b decision 3): org id, event type id, source. */
export type ServerEventProps = {
  org?: string | null;
  event_type?: string | number | null;
  source?: string | null;
};

const TIMEOUT_MS = 2000;

/** Plausible Events API body; exported for tests. Returns null when Plausible is not configured. */
export function buildPlausibleRequest(
  name: ServerEventName,
  props: ServerEventProps,
  env: Partial<Record<"PLAUSIBLE_HOST" | "PLAUSIBLE_DOMAIN", string>> = process.env as Partial<
    Record<"PLAUSIBLE_HOST" | "PLAUSIBLE_DOMAIN", string>
  >
): { url: string; body: Record<string, unknown> } | null {
  const host = env.PLAUSIBLE_HOST?.trim().replace(/\/+$/, "");
  const domain = env.PLAUSIBLE_DOMAIN?.trim();
  if (!host || !domain) return null;
  const cleanProps: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v !== undefined && v !== null && v !== "") cleanProps[k] = String(v);
  }
  return {
    url: `${host}/api/event`,
    body: { name, domain, url: `https://${domain}/server/${name}`, props: cleanProps },
  };
}

/**
 * Fire-and-forget server-side Plausible event. Never throws and never awaits the
 * network from the caller's point of view: a slow or down Plausible must not slow
 * or fail the user action. No-op when PLAUSIBLE_HOST / PLAUSIBLE_DOMAIN are unset.
 */
export function trackServerEvent(name: ServerEventName, props: ServerEventProps = {}): void {
  const req = buildPlausibleRequest(name, props);
  if (!req) return;
  fetch(req.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "timeway-server/1.0" },
    body: JSON.stringify(req.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).then(
    (res) => {
      if (!res.ok) log.warn(`plausible ${name} -> HTTP ${res.status}`);
    },
    (err: unknown) => log.warn(`plausible ${name} failed: ${(err as Error)?.message ?? err}`)
  );
}
