// First-party proxy for the self-hosted Plausible CE at PLAUSIBLE_HOST (WC-TW-9a). Serving the script
// and the event endpoint from our own origin keeps ad-blockers that match third-party analytics hosts
// from dropping funnel events.
export const PLAUSIBLE_SCRIPT_PATH = "/js/pa.js";
export const PLAUSIBLE_EVENT_PATH = "/api/pa/event";
const PLAUSIBLE_SCRIPT_VARIANT = "script.tagged-events.pageview-props.js";

export type PlausibleRewrite = { source: string; destination: string };

export function getPlausibleRewrites(plausibleHost: string | undefined): PlausibleRewrite[] {
  const host = plausibleHost?.trim().replace(/\/+$/, "");
  if (!host) return [];
  const origin = /^https?:\/\//.test(host) ? host : `https://${host}`;
  return [
    { source: PLAUSIBLE_SCRIPT_PATH, destination: `${origin}/js/${PLAUSIBLE_SCRIPT_VARIANT}` },
    { source: PLAUSIBLE_EVENT_PATH, destination: `${origin}/api/event` },
  ];
}
