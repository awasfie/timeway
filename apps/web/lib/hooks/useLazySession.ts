"use client";

import type { Session } from "next-auth";
import { useEffect, useState } from "react";

/**
 * WC-TW-6n-4b: the public booking pages read the session without next-auth/react.
 *
 * next-auth's SessionProvider (and its client runtime) used to be mounted in the root layout, which
 * put it on the public booker's first load. The booker only needs "is someone signed in, and who"
 * (prefill, own-page detection, email verification skip, analytics identify), so it reads
 * /api/auth/session once per page load after hydration. Signed-in app pages keep SessionProvider
 * ((use-page-wrapper)/AppShellProviders, Pages Router _app).
 */
export type LazySessionStatus = "loading" | "authenticated" | "unauthenticated";
export type LazySessionValue = { data: Session | null; status: LazySessionStatus };

let sessionPromise: Promise<Session | null> | null = null;
let resolved: Session | null | undefined;

function loadSession(): Promise<Session | null> {
  if (!sessionPromise) {
    sessionPromise = fetch("/api/auth/session", { credentials: "same-origin", headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: unknown) => {
        const s = json && typeof json === "object" && Object.keys(json).length > 0 ? (json as Session) : null;
        resolved = s;
        return s;
      })
      .catch(() => {
        resolved = null;
        return null;
      });
  }
  return sessionPromise;
}

function toValue(s: Session | null | undefined): LazySessionValue {
  if (s === undefined) return { data: null, status: "loading" };
  return { data: s, status: s ? "authenticated" : "unauthenticated" };
}

export function useLazySession(): LazySessionValue {
  // Start as "loading" on server and first client render so hydration matches.
  const [value, setValue] = useState<LazySessionValue>(() => toValue(undefined));
  useEffect(() => {
    let alive = true;
    if (resolved !== undefined) {
      setValue(toValue(resolved));
      return;
    }
    loadSession().then((s) => {
      if (alive) setValue(toValue(s));
    });
    return () => {
      alive = false;
    };
  }, []);
  return value;
}

/** @internal test hook */
export function __resetLazySession() {
  sessionPromise = null;
  resolved = undefined;
}
