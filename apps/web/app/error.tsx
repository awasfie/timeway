"use client";

import dynamic from "next/dynamic";

import type { ErrorProps } from "./errorBody";

export type { ErrorProps } from "./errorBody";

// WC-TW-6n-3: the root error boundary is part of every route's first-load entry set. Keep the
// boundary itself thin and load the real UI (ErrorPage, error codes, logger) only when it renders.
const ErrorBody = dynamic(() => import("./errorBody"));

export default function Error(props: ErrorProps) {
  return <ErrorBody {...props} />;
}
