"use client";

import PageWrapper from "@components/PageWrapperAppDir";

import { NotFound } from "./notFoundClient";

export default function NotFoundPage({ nonce, host }: { nonce: string | undefined; host: string }) {
  return (
    <PageWrapper requiresLicense={false} nonce={nonce}>
      <NotFound host={host} />
    </PageWrapper>
  );
}
