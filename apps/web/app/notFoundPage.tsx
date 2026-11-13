"use client";

import PageWrapper from "@components/PageWrapperAppDir";

import { NotFound } from "./notFoundClient";
import "../styles/app.css";

export default function NotFoundPage({ nonce, host }: { nonce: string | undefined; host: string }) {
  return (
    <PageWrapper requiresLicense={false} nonce={nonce}>
      <NotFound host={host} />
    </PageWrapper>
  );
}
