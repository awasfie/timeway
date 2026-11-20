"use client";

import "@calcom/embed-core/src/embed-iframe/loader";

import { AuthAppProviders } from "@lib/app-providers-app-dir";

import type { PageWrapperProps } from "@components/PageWrapperAppDir";

// Same nonce handling as PageWrapperAppDir, minus the feature-flag provider (see AuthAppProviders).
export default function AuthPageWrapper(props: PageWrapperProps) {
  const nonce = typeof window !== "undefined" ? (props.nonce ? "" : undefined) : props.nonce;
  return <AuthAppProviders {...props} nonce={nonce} />;
}
