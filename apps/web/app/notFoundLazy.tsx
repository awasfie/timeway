"use client";

import dynamic from "next/dynamic";

// WC-TW-6n-3: the root not-found boundary is part of every route's first-load entry set. Its
// PageWrapper + NotFound body loads only when a 404 actually renders (still server-rendered).
const NotFoundPage = dynamic(() => import("./notFoundPage"));

export function NotFoundLazy(props: { nonce: string | undefined; host: string }) {
  return <NotFoundPage {...props} />;
}
