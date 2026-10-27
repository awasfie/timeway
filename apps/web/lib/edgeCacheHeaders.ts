// Origin Cache-Control for the user-independent static shell (WC-TW-6b).
// The Cloudflare cache rules in ops/cloudflare/timeway-cache-rules.json only make these paths
// cache-eligible; TTLs come from here (edge_ttl: respect_origin), so the origin stays the source of truth.
// HTML is deliberately absent: the booking page reads the session server-side, so it is not user-independent.
export const STATIC_SHELL_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";

export const STATIC_SHELL_SOURCES = [
  "/fonts/:path*",
  "/favicon.ico",
  "/favicon-:size(16x16|32x32).png",
  "/apple-touch-icon.png",
  "/android-chrome-:size(192x192|256x256|384x384|512x512).png",
  "/mstile-:size(70x70|144x144|150x150|310x150|310x310).png",
  "/safari-pinned-tab.svg",
  "/:logo(cal-logo-word|cal-logo-word-dark|cal-logo-word-black|calcom-logo-white-word|cal-com-icon|cal-com-icon-white).svg",
] as const;

export const staticShellHeaders = () =>
  STATIC_SHELL_SOURCES.map((source) => ({
    source,
    headers: [{ key: "Cache-Control", value: STATIC_SHELL_CACHE_CONTROL }],
  }));
