"use client";

import { TrpcProvider } from "app/_trpc/trpc-provider";
import { SessionProvider } from "next-auth/react";

import { AnalyticsIdentify } from "@lib/analytics/AnalyticsIdentify";

import { GeoProvider } from "./GeoContext";

type ProvidersProps = {
  isEmbed: boolean;
  children: React.ReactNode;
  nonce: string | undefined;
  country: string;
};
// WC-TW-6n-1: SessionProvider and TrpcProvider stay here because the booker reads the session
// (prefill, own-page detection) and loads slots through tRPC on first render. Web push, the
// notification sound, react-inlinesvg's cache and nuqs moved to (use-page-wrapper)/AppShellProviders.
// WC-TW-6n-2: the coss ToastProvider (base-ui toast + floating-ui) moved there too; the booker never
// uses coss toasts (its toasts are sonner, loaded on demand).
export function Providers({ children, country }: ProvidersProps) {
  return (
    <GeoProvider country={country}>
      <SessionProvider>
        <AnalyticsIdentify />
        <TrpcProvider>
          {children}
        </TrpcProvider>
      </SessionProvider>
    </GeoProvider>
  );
}
