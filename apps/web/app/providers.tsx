"use client";

import { TrpcProvider } from "app/_trpc/trpc-provider";
import CacheProvider from "react-inlinesvg/provider";
import { ToastProvider } from "@coss/ui/components/toast";

import { GeoProvider } from "./GeoContext";

type ProvidersProps = {
  isEmbed: boolean;
  children: React.ReactNode;
  nonce: string | undefined;
  country: string;
};
// SessionProvider, WebPushProvider and NotificationSoundHandler live in AuthedAppProviders (logged-in app
// tree only) so the public booking route does not ship next-auth/react or sonner on first load.
export function Providers({ children, country }: ProvidersProps) {
  return (
    <GeoProvider country={country}>
      <TrpcProvider>
        <ToastProvider position="bottom-center">
          {/* @ts-expect-error react-inlinesvg/provider is incompatible with @types/react@18.0.26. Remove when these types are compatible. */}
          <CacheProvider>{children}</CacheProvider>
        </ToastProvider>
      </TrpcProvider>
    </GeoProvider>
  );
}
