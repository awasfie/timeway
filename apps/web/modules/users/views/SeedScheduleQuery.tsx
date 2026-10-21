"use client";

import { queryClient } from "app/_trpc/query-client";
import { trpc } from "app/_trpc/trpc";
import { getQueryKey } from "@trpc/react-query";
import { useState } from "react";
import superjson from "superjson";

type Props = {
  input: Parameters<typeof trpc.viewer.slots.getSchedule.useQuery>[0];
  serializedData: ReturnType<typeof superjson.serialize>;
  children: React.ReactNode;
};

/**
 * Seeds the react-query cache with the slots the server already computed, under the exact key
 * useSchedule uses, so the Booker does not refetch the first month on mount (WC-TW-6a2).
 */
export default function SeedScheduleQuery({ input, serializedData, children }: Props) {
  useState(() => {
    const queryKey = getQueryKey(trpc.viewer.slots.getSchedule, input, "query");
    if (!queryClient.getQueryData(queryKey)) {
      queryClient.setQueryData(queryKey, superjson.deserialize(serializedData));
    }
    return true;
  });
  return <>{children}</>;
}
