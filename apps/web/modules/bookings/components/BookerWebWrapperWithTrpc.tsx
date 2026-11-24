"use client";

import { TrpcProvider } from "app/_trpc/trpc-provider";

import type { BookerWebWrapperAtomProps } from "./BookerWebWrapper";
import { BookerWebWrapper } from "./BookerWebWrapper";

/**
 * WC-TW-6n-4c: the interactive booker together with its data layer (tRPC client, react-query,
 * superjson). Only ever loaded through BookerWebWrapperLazy, so none of it is on the booking route's
 * first load.
 */
export default function BookerWebWrapperWithTrpc(props: BookerWebWrapperAtomProps) {
  return (
    <TrpcProvider>
      <BookerWebWrapper {...props} />
    </TrpcProvider>
  );
}
