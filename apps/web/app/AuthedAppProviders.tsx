"use client";

import { SessionProvider } from "next-auth/react";

import { NotificationSoundHandler } from "@calcom/web/components/notification-sound-handler";
import { WebPushProvider } from "@calcom/web/modules/notifications/components/WebPushContext";

import useIsBookingPage from "@lib/hooks/useIsBookingPage";

type AuthedAppProvidersProps = {
  isEmbed: boolean;
  children: React.ReactNode;
};

// Mounted only by the logged-in app tree (use-page-wrapper, not-found) so that next-auth/react,
// web push and the notification sound stay off the public booking route's first load.
export function AuthedAppProviders({ isEmbed, children }: AuthedAppProvidersProps) {
  const isBookingPage = useIsBookingPage();

  return (
    <SessionProvider>
      {!isEmbed && !isBookingPage && <NotificationSoundHandler />}
      <WebPushProvider>{children}</WebPushProvider>
    </SessionProvider>
  );
}
