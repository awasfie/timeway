"use client";

import { BookerWebWrapperLazy as Booker } from "@calcom/web/modules/bookings/components/BookerWebWrapperLazy";
import { getBookerWrapperClasses } from "@calcom/features/bookings/Booker/utils/getBookerWrapperClasses";

import { type PageProps } from "@lib/d/[link]/[slug]/getServerSideProps";

import BookingPageErrorBoundary from "@components/error/BookingPageErrorBoundary";

export default function Type({
  slug,
  isEmbed,
  user,
  booking,
  isBrandingHidden,
  isTeamEvent,
  entity,
  duration,
  hashedLink,
  durationConfig,
  eventData,
  useApiV2,
  shellNow,
}: PageProps & { shellNow?: number }) {
  return (
    <BookingPageErrorBoundary>
      <main className={getBookerWrapperClasses({ isEmbed: !!isEmbed })}>
        <Booker
          isEmbed={!!isEmbed}
          shellNow={shellNow}
          eventData={eventData}
          username={user}
          eventSlug={slug}
          bookingData={booking}
          hideBranding={isBrandingHidden}
          isTeamEvent={isTeamEvent}
          entity={entity}
          duration={duration}
          hashedLink={hashedLink}
          durationConfig={durationConfig}
          useApiV2={useApiV2}
        />
      </main>
    </BookingPageErrorBoundary>
  );
}
