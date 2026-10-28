type CaptureProperties = Record<string, unknown>;

// posthog-js is ~50 KB gz; a static import from a shared module put it on the public booking
// page's first load (WC-TW-6c-6). Load it only on the first capture, and only when a key is set.
export function captureEvent(event: string, properties?: CaptureProperties): void {
  if (typeof window === "undefined" || !process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  void import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.capture(event, properties);
    })
    .catch(() => undefined);
}
