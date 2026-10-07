/**
 * Timeway brand design tokens — transcribed from Bible v12.6 PART UX, UX.1.2
 * "Effortless Path Forward", Brand v1 (2026-09-13). Nothing here changes without
 * a new brand package from Ahmed (UX.1 header). Together with
 * packages/config/theme/brand-timeway.css this is the only place brand hex
 * literals may live (UX.0.10; enforced by packages/ui/scripts/check-no-hex.mjs).
 */
export const tokens = {
  /** Timeway Ink — wordmark, headings, primary buttons, dark surfaces. */
  primary: "#16395E",
  /** Timeway Seafoam — progress, selected slot, success moment; never body text (2.2:1 on white). */
  accent: "#79BBAE",
  /** Timeway Paper — page background. */
  surface: "#F8F8F4",
  /** Cards, booking panel. */
  "surface-alt": "#FFFFFF",
  ink: "#16395E",
  "ink-muted": "#5C6F86",
  border: "#E3E4DD",
  success: "#2E8B6E",
  warning: "#B7791F",
  danger: "#B42318",
  info: "#16395E",
} as const;

/** UX.1.2 buttons: primary Ink/white; accent Seafoam bg + Ink text only for "Confirm this time"; secondary Ink outline. */
export const buttonTokens = {
  primary: { bg: tokens.primary, fg: tokens["surface-alt"] },
  accent: { bg: tokens.accent, fg: tokens.ink },
  secondary: { border: tokens.primary, fg: tokens.primary },
} as const;

/** UX.1.2 radii (px): soft, rounded field. Keys brand-* avoid Tailwind's rounded-r-* (physical right). */
export const radii = { "brand-sm": 8, "brand-md": 10, "brand-lg": 16, "brand-full": 999 } as const;

/** UX.1.2 typefaces: DM Sans 600/500/400; Arabic companion Noto Sans Arabic 700/500/400. */
export const fonts = { sans: "DM Sans", arabic: "Noto Sans Arabic" } as const;
