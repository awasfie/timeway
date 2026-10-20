// WC-DX-14c1: the four spec axes, same file shape as salesos packages/ui/.storybook/globals.ts.
// Timeway carries one brand pack (packages/config/theme/brand-timeway.css, UX-T0).
export const BRANDS = ["timeway"] as const;
export const THEMES = ["light", "dark"] as const;
export const LOCALES = ["en", "ar"] as const;
export type Brand = (typeof BRANDS)[number];
export type Theme = (typeof THEMES)[number];
export type Locale = (typeof LOCALES)[number];

/** UX.13 / WC-DX-6 viewports: 390 mobile, 768 tablet, 1280 desktop. */
export const VIEWPORTS = {
  mobile390: { name: "390 mobile", styles: { width: "390px", height: "844px" }, type: "mobile" },
  tablet768: { name: "768 tablet", styles: { width: "768px", height: "1024px" }, type: "tablet" },
  desktop1280: { name: "1280 desktop", styles: { width: "1280px", height: "800px" }, type: "desktop" },
} as const;
export type Viewport = keyof typeof VIEWPORTS;

/** `ar/dark/390` is the hardest default combination; every component story set carries it. */
export const PRESETS = {
  "ar/dark/390": { locale: "ar", theme: "dark", viewport: { value: "mobile390", isRotated: false } },
  "en/light/1280": { locale: "en", theme: "light", viewport: { value: "desktop1280", isRotated: false } },
} as const;
