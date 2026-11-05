"use client";

import { TrpcProvider } from "app/_trpc/trpc-provider";

import { AnalyticsIdentify } from "@lib/analytics/AnalyticsIdentify";

import { GeoProvider } from "./GeoContext";

type ProvidersProps = {
  isEmbed: boolean;
  children: React.ReactNode;
  nonce: string | undefined;
  country: string;
};
// WC-TW-6n-4b: SessionProvider moved to (use-page-wrapper)/AppShellProviders; the public booker reads
// the session through @lib/hooks/useLazySession (no next-auth/react on its first load).
// WC-TW-6n-1: TrpcProvider stays here because the booker reads the session
// (prefill, own-page detection) and loads slots through tRPC on first render. Web push, the
// notification sound, react-inlinesvg's cache and nuqs moved to (use-page-wrapper)/AppShellProviders.
// WC-TW-6n-2: the coss ToastProvider (base-ui toast + floating-ui) moved there too; the booker never
// uses coss toasts (its toasts are sonner, loaded on demand).
export function Providers({ children, country }: ProvidersProps) {
  return (
    <GeoProvider country={country}>
      <AnalyticsIdentify />
      <TrpcProvider>{children}</TrpcProvider>
    </GeoProvider>
  );
}
