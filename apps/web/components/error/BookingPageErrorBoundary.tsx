import React, { Suspense, lazy } from "react";
import { ErrorBoundary } from "react-error-boundary";

// WC-TW-6n-4d: ErrorPage pulls Button -> Icon/Tooltip -> @radix-ui/react-tooltip, @floating-ui and tailwind-merge.
// It only renders after a crash, so it loads on demand instead of shipping in the booking page's first load.
const ErrorPage = lazy(() => import("./error-page").then((m) => ({ default: m.ErrorPage })));

/** Shown while ErrorPage loads, and in its place if its chunk cannot load (e.g. the network is down). */
const PlainError = ({ message }: { message: string }) => (
  <div className="bg-subtle flex h-screen items-center justify-center p-4">
    <div className="text-center">
      <h1 className="text-emphasis text-xl font-semibold">Something went wrong</h1>
      <p className="text-default mt-2 text-sm">{message}</p>
      <button
        type="button"
        className="text-emphasis mt-4 rounded-md border px-4 py-2 text-sm"
        onClick={() => window.location.reload()}>
        Try again
      </button>
    </div>
  </div>
);

export default function BookingPageErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => (
        <ErrorBoundary fallbackRender={() => <PlainError message={`${error}`} />}>
          <Suspense fallback={<PlainError message={`${error}`} />}>
            <ErrorPage reset={resetErrorBoundary} error={error} message={`${error}`} displayDebug={true} />
          </Suspense>
        </ErrorBoundary>
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
