"use client";

import { NotificationSoundHandler } from "@calcom/web/components/notification-sound-handler";
import { WebPushProvider } from "@calcom/web/modules/notifications/components/WebPushContext";
import { useNuqsParams } from "@lib/hooks/useNuqsParams";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import CacheProvider from "react-inlinesvg/provider";

// WC-TW-6n-1: providers only the signed-in app uses. They used to sit in the root layout, which put
// web push (and its service-worker registration), nuqs and the react-inlinesvg cache on the public
// booking route's first load. The booking route group renders without them.
export function AppShellProviders({ isEmbed, children }: { isEmbed: boolean; children: React.ReactNode }) {
  const nuqsParams = useNuqsParams();
  return (
    <>
      {!isEmbed && <NotificationSoundHandler />}
      {/* @ts-expect-error react-inlinesvg/provider is incompatible with @types/react@18.0.26. Remove when these types are compatible. */}
      <CacheProvider>
        <NuqsAdapter {...nuqsParams}>
          <WebPushProvider>{children}</WebPushProvider>
        </NuqsAdapter>
      </CacheProvider>
    </>
  );
}
