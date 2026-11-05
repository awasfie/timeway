"use client";

import { NotificationSoundHandler } from "@calcom/web/components/notification-sound-handler";
import { WebPushProvider } from "@calcom/web/modules/notifications/components/WebPushContext";
import { useNuqsParams } from "@lib/hooks/useNuqsParams";
import { FeatureProvider } from "@calcom/features/flags/context/provider";
import { useFlags } from "@calcom/web/modules/feature-flags/hooks/useFlags";
import { TrpcProvider } from "app/_trpc/trpc-provider";
import { SessionProvider } from "next-auth/react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import CacheProvider from "react-inlinesvg/provider";
import { ToastProvider } from "@coss/ui/components/toast";

// WC-TW-6n-1: providers only the signed-in app uses. They used to sit in the root layout, which put
// web push (and its service-worker registration), nuqs and the react-inlinesvg cache on the public
// booking route's first load. The booking route group renders without them.
export function AppShellProviders({ isEmbed, children }: { isEmbed: boolean; children: React.ReactNode }) {
  const nuqsParams = useNuqsParams();
  // WC-TW-6n-4b: SessionProvider lives here (not the root layout) so next-auth/react stays off the
  // public booking route group.
  return (
    <SessionProvider>
      {/* WC-TW-6n-4c: tRPC/react-query and the feature-flag provider live here, not in the root layout,
          so the public booking route group loads them only with the interactive booker. */}
      <TrpcProvider>
        <FeatureFlagsProvider>
          {!isEmbed && <NotificationSoundHandler />}
          {/* @ts-expect-error react-inlinesvg/provider is incompatible with @types/react@18.0.26. Remove when these types are compatible. */}
          <CacheProvider>
            <NuqsAdapter {...nuqsParams}>
              <WebPushProvider>
                <ToastProvider position="bottom-center">{children}</ToastProvider>
              </WebPushProvider>
            </NuqsAdapter>
          </CacheProvider>
        </FeatureFlagsProvider>
      </TrpcProvider>
    </SessionProvider>
  );
}

function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const flags = useFlags();
  return <FeatureProvider value={flags}>{children}</FeatureProvider>;
}
