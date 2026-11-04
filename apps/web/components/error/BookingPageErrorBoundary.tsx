import React from "react";
import { ErrorBoundary } from "react-error-boundary";

import { ErrorPage } from "./error-page";

export default function BookingPageErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => (
        <ErrorPage reset={resetErrorBoundary} error={error} message={`${error}`} displayDebug={true} />
      )}
      onError={(error, info) => {
        console.error(error);
        // Lazy so @sentry/nextjs stays off the booking page's first load (WC-TW-6c-6).
        void import("@sentry/nextjs")
          .then(({ captureReactException }) => captureReactException(error, info))
          .catch(() => undefined);
      }}>
      {children}
    </ErrorBoundary>
  );
}
