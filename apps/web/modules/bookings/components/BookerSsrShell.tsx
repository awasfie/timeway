import type { BookerEvent } from "@calcom/features/bookings/types";
import classNames from "@calcom/ui/classNames";
import { EventMembers } from "./event-meta/Members";
import { EventTitle } from "./event-meta/Title";

type BookerSsrShellProps = {
  event: Pick<BookerEvent, "schedulingType" | "subsetOfUsers" | "profile" | "entity" | "title">;
  isPrivateLink: boolean;
  roundRobinHideOrgAndTeam?: boolean;
  hideOrgTeamAvatar?: boolean;
};

/**
 * Painted by the server while the booker store is still "loading" (it only leaves that state in a
 * client effect), so the event title, the page's LCP element, is visible before the booker JS
 * hydrates (WC-TW-6h). Props only: server and first client render are identical. Placed where the
 * meta column of the mobile booker sits, so the swap to the full booker does not move the title.
 */
export const BookerSsrShell = ({
  event,
  isPrivateLink,
  roundRobinHideOrgAndTeam,
  hideOrgTeamAvatar,
}: BookerSsrShellProps) => (
  <div
    data-testid="booker-ssr-shell"
    className="main text-default flex min-h-[100dvh] w-full flex-col items-center md:my-20 md:min-h-0">
    <div
      className={classNames(
        "bg-default dark:bg-cal-muted w-full max-w-full md:w-auto",
        "md:border-subtle md:rounded-md md:border"
      )}>
      <div className="relative z-10 w-full p-6 md:w-[280px]">
        <EventMembers
          schedulingType={event.schedulingType}
          users={event.subsetOfUsers}
          profile={event.profile}
          entity={event.entity}
          isPrivateLink={isPrivateLink}
          roundRobinHideOrgAndTeam={roundRobinHideOrgAndTeam}
          hideOrgTeamAvatar={hideOrgTeamAvatar}
        />
        <EventTitle className="my-2">{event.title}</EventTitle>
      </div>
    </div>
  </div>
);
