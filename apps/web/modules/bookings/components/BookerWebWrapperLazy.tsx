"use client";

import type { ComponentType } from "react";
import { useEffect, useState } from "react";

import type { BookerWebWrapperAtomProps } from "./BookerWebWrapper";
import type { BookerFirstPaintEvent } from "./BookerFirstPaintShell";
import { BookerFirstPaintShell } from "./BookerFirstPaintShell";

type Props = BookerWebWrapperAtomProps & {
  /** Event meta for the server-rendered first paint (pages whose booker fetches the event itself
   * still have it from getServerSideProps). */
  shellEvent?: BookerFirstPaintEvent | null;
  /** Epoch ms of the server render, for the month picker of the first paint. */
  shellNow?: number | null;
  isEmbed?: boolean;
};

type Loaded = ComponentType<BookerWebWrapperAtomProps>;

// A plain import() (not next/dynamic) so the chunk is neither preloaded in the HTML nor rendered on
// the server: the server paints BookerFirstPaintShell and the client fetches the booker after
// hydration. Started at module evaluation so the fetch overlaps hydration.
let pending: Promise<Loaded> | null = null;
const loadBooker = () => {
  if (!pending) {
    pending = import("./BookerWebWrapperWithTrpc").then((m) => m.default);
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
};
if (typeof window !== "undefined") void loadBooker().catch(() => undefined);

/**
 * WC-TW-6n-4c: public booker entry. First paint (server HTML and the hydration render) is the
 * props-only BookerFirstPaintShell; the tRPC/react-query/superjson booker replaces it once its lazy
 * chunk arrives. Embeds keep painting nothing until the booker is ready, as before.
 */
export const BookerWebWrapperLazy = ({ shellEvent, shellNow, isEmbed, ...props }: Props) => {
  const [Booker, setBooker] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    loadBooker()
      .then((C) => alive && setBooker(() => C))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, []);

  // Surface chunk-load failures to BookingPageErrorBoundary instead of a shell that never resolves.
  if (error) throw error;
  if (Booker) return <Booker {...props} />;
  const event = shellEvent ?? props.eventData;
  if (isEmbed || !event || props.entity?.considerUnpublished) return null;
  return <BookerFirstPaintShell event={event} now={shellNow} />;
};
