import { useQuery } from "@tanstack/react-query";

import type {
  GetAvailableSlotsInput_2024_04_15,
  ApiResponse,
  ApiSuccessResponse,
} from "@calcom/platform-types";
import type { GetAvailableSlotsResponse } from "@calcom/trpc/server/routers/viewer/slots/util";

export const QUERY_KEY = "get-available-slots";

export const useApiV2AvailableSlots = ({
  enabled,
  ...rest
}: GetAvailableSlotsInput_2024_04_15 & { enabled: boolean }) => {
  const availableSlots = useQuery({
    queryKey: [
      QUERY_KEY,
      rest.startTime,
      rest.endTime,
      rest.eventTypeId,
      rest.eventTypeSlug,
      rest.isTeamEvent ?? false,
      rest.teamId ?? false,
      rest.usernameList,
      rest.routedTeamMemberIds,
      rest.skipContactOwner,
      rest.teamMemberEmail,
      rest.embedConnectVersion ?? false,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(rest)) {
        if (value === undefined || value === null) continue;
        // Same wire format axios used: arrays as repeated `key[]=` entries.
        if (Array.isArray(value)) value.forEach((v) => params.append(`${key}[]`, String(v)));
        else params.append(key, String(value));
      }
      const res = await fetch(`/api/v2/slots/available?${params.toString()}`);
      const body = (await res.json()) as ApiResponse<GetAvailableSlotsResponse>;
      if (body.status === "success") {
        return (body as ApiSuccessResponse<GetAvailableSlotsResponse>).data;
      }
      throw new Error(body.error.message);
    },
    enabled: enabled,
  });
  return availableSlots;
};
