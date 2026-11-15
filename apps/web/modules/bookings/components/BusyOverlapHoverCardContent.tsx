import * as HoverCard from "@radix-ui/react-hover-card";
import type { ReactNode } from "react";

export default function BusyOverlapHoverCardContent({
  overlappingTimeStart,
  overlappingTimeEnd,
  children,
}: {
  overlappingTimeStart: string | null;
  overlappingTimeEnd: string | null;
  children: ReactNode;
}) {
  return (
    <HoverCard.Root>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content side="top" align="end" sideOffset={2}>
          <div className="text-emphasis bg-inverted w-(--booker-timeslots-width) rounded-md p-3">
            <div className="flex items-center gap-2">
              <p>Busy</p>
            </div>
            <p className="text-muted">
              {overlappingTimeStart} - {overlappingTimeEnd}
            </p>
          </div>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
