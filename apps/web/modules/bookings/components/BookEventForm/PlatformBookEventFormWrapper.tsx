import { useEventTypeById } from "@calcom/atoms/hooks/event-types/private/useEventTypeById";
import { useBookerStoreContext } from "@calcom/features/bookings/Booker/BookerStoreProvider";
import type { ReactNode } from "react";
import { BookEventFormWrapperComponent } from "./BookFormAsModal";

export const PlatformBookEventFormWrapper = ({
  children,
  onCancel,
}: {
  onCancel: () => void;
  children: ReactNode;
}) => {
  const eventId = useBookerStoreContext((state) => state.eventId);
  const { data } = useEventTypeById(eventId);

  return (
    <BookEventFormWrapperComponent child={children} eventLength={data?.lengthInMinutes} onCancel={onCancel} />
  );
};
