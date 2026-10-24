import { cookies, headers } from "next/headers";

import PageWrapper from "@components/PageWrapperAppDir";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { BookingSessionProvider } from "@lib/booking-session";
import { getBookingSession } from "@lib/getBookingSession";

export default async function BookingPageWrapperLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const nonce = h.get("x-csp-nonce") ?? undefined;
  const session = await getBookingSession(buildLegacyRequest(h, await cookies()));

  return (
    <>
      <PageWrapper isBookingPage={true} requiresLicense={false} nonce={nonce}>
        <BookingSessionProvider session={session}>{children}</BookingSessionProvider>
      </PageWrapper>
    </>
  );
}
