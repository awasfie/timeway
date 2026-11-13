import type { ReactNode } from "react";
import { lazy, Suspense } from "react";

// WC-TW-6n-3: @radix-ui/react-hover-card (+ popper/floating-ui) only matters when the selected slot
// overlaps a busy event from the overlay calendar. Without an overlap the confirm button renders
// bare, so the hover card loads on demand instead of shipping on the booking first load. While the
// chunk loads the button still renders (Suspense fallback), only the hover tooltip waits.
const BusyOverlapHoverCardContent = lazy(() => import("./BusyOverlapHoverCardContent"));

export type BusyOverlapHoverCardProps = {
  open: boolean;
  overlappingTimeStart: string | null;
  overlappingTimeEnd: string | null;
  children: ReactNode;
};

export function BusyOverlapHoverCard({ open, children, ...rest }: BusyOverlapHoverCardProps) {
  if (!open) return <>{children}</>;
  return (
    <Suspense fallback={children}>
      <BusyOverlapHoverCardContent {...rest}>{children}</BusyOverlapHoverCardContent>
    </Suspense>
  );
}
