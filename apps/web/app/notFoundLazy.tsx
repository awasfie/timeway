"use client";

import dynamic from "next/dynamic";
import type { AppProvidersValue } from "./AppProviders";

// WC-TW-6n-3: the root not-found boundary is part of every route's first-load entry set. Its
// providers + PageWrapper + NotFound body load only when a 404 actually renders (still server-rendered).
const NotFoundPage = dynamic(() => import("./notFoundPage"));

export function NotFoundLazy(props: {
  nonce: string | undefined;
  host: string;
  appProviderProps: AppProvidersValue;
}) {
  return <NotFoundPage {...props} />;
}
