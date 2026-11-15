import { IconSprites } from "@calcom/ui/components/icon";
import { RumBeacon } from "@lib/telemetry/rum-client";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import { headers } from "next/headers";
import Script from "next/script";
import type React from "react";

import "../styles/globals.css";
import process from "node:process";
import { AnalyticsInit } from "./AnalyticsInit";
import { getRequestLocale } from "./requestLocale";
import { SpeculationRules } from "./SpeculationRules";

// UX.13.3-2: no font is preloaded from the root layout. The marketing pages render DMSans (brand-timeway.css
// @font-face), so preloading Inter and CalSans here made every signed-out visit fetch ~88 KB of fonts it
// never paints. App pages still get both faces, fetched on first use, and
// CalSans swaps against a metric-adjusted fallback instead of blocking text (display "block" hid headings).
const interFont = Inter({ subsets: ["latin"], variable: "--font-sans", preload: false, display: "swap" });
const calFont = localFont({
  src: "../fonts/CalSans-SemiBold.woff2",
  variable: "--font-cal",
  preload: false,
  display: "swap",
  adjustFontFallback: "Arial",
  weight: "600",
});

export const viewport = {
  width: "device-width",
  initialScale: 1.0,
  maximumScale: 1.0,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    {
      media: "(prefers-color-scheme: light)",
      color: "#f9fafb",
    },
    {
      media: "(prefers-color-scheme: dark)",
      color: "#1C1C1C",
    },
  ],
};

export const metadata = {
  icons: {
    icon: "/api/logo?type=favicon-32",
    apple: "/api/logo?type=apple-touch-icon",
    other: [
      {
        rel: "icon-mask",
        url: "/safari-pinned-tab.svg",
        color: "#000000",
      },
      {
        url: "/api/logo?type=favicon-16",
        sizes: "16x16",
        type: "image/png",
      },
      {
        url: "/api/logo?type=favicon-32",
        sizes: "32x32",
        type: "image/png",
      },
    ],
  },
  manifest: "/site.webmanifest",
  other: {
    "application-TileColor": "#16395E",
  },
  twitter: {
    site: "@timeway",
    creator: "@timeway",
    card: "summary_large_image",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const nonce = h.get("x-csp-nonce") ?? "";

  const { locale, direction, isEmbed, embedColorScheme } = await getRequestLocale();

  return (
    <html
      className="notranslate"
      translate="no"
      lang={locale}
      dir={direction}
      style={embedColorScheme ? { colorScheme: embedColorScheme as string } : undefined}
      suppressHydrationWarning
      data-nextjs-router="app">
      <head nonce={nonce}>
        <style>{`
          :root {
            --font-sans: ${interFont.style.fontFamily.replace(/'/g, "")}, system-ui;
            --font-cal: ${calFont.style.fontFamily.replace(/'/g, "")};
          }
        `}</style>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="//unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
            data-options='{"activationKey":"Meta+c"}'
          />
        )}
      </head>
      <body
        className="dark:bg-default bg-subtle antialiased"
        style={
          isEmbed
            ? {
                background: "transparent",
                // Keep the embed hidden till parent initializes and
                // - gives it the appropriate styles if UI instruction is there.
                // - gives iframe the appropriate height(equal to document height) which can only be known after loading the page once in browser.
                // - Tells iframe which mode it should be in (dark/light) - if there is a a UI instruction for that
                visibility: "hidden",
                // This in addition to visibility: hidden is to ensure that elements with specific opacity set are not visible
                opacity: 0,
              }
            : {
                visibility: "visible",
                opacity: 1,
              }
        }>
        <IconSprites />
        <RumBeacon />
        <SpeculationRules
          // URLs In Navigation
          prerenderPathsOnHover={["/event-types", "/availability", "/bookings/upcoming", "/teams", "/apps"]}
        />

        <AnalyticsInit />
        {/* UX.13.3-3b: app providers + translations live in AppProvidersServer (route-group layouts). */}
        {children}
      </body>
    </html>
  );
}
