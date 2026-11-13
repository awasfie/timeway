"use client";

import PageWrapper from "@components/PageWrapperAppDir";
import { AppProviders, type AppProvidersValue } from "./AppProviders";
import { NotFound } from "./notFoundClient";

export default function NotFoundPage({
  nonce,
  host,
  appProviderProps,
}: {
  nonce: string | undefined;
  host: string;
  appProviderProps: AppProvidersValue;
}) {
  return (
    <AppProviders {...appProviderProps}>
      <PageWrapper requiresLicense={false} nonce={nonce}>
        <NotFound host={host} />
      </PageWrapper>
    </AppProviders>
  );
}
