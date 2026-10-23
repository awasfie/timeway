"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import type { ExternalToast, ToasterProps } from "sonner";

type ToastVariants = "success" | "warning" | "error";

// Public pages (booking route) must not ship sonner on first load. The Toaster and toast() are fetched
// on the first showToastLazy call. sonner keeps toasts in a module singleton and a Toaster only sees
// toasts published after it subscribed, so a toast is fired only once a mounted Toaster has subscribed.
const activators = new Set<() => void>();
const readyWaiters: Array<() => void> = [];
let mountedToasters = 0;

function markToasterMounted() {
  mountedToasters += 1;
  readyWaiters.splice(0).forEach((resolve) => resolve());
  return () => {
    mountedToasters -= 1;
  };
}

function whenToasterReady(): Promise<void> {
  // No LazyToaster on the page (e.g. an eager Toaster from the app shell owns toasts): fire directly.
  if (mountedToasters > 0 || activators.size === 0) return Promise.resolve();
  return new Promise((resolve) => {
    readyWaiters.push(resolve);
    activators.forEach((activate) => activate());
  });
}

// React.lazy rather than next/dynamic: this module is also bundled by platform atoms (no Next runtime).
// It only renders after a client effect, so it never runs during SSR.
const SonnerToaster = lazy(() =>
  import("sonner").then(({ Toaster }) => {
    function MountedToaster(props: ToasterProps) {
      // Child effects run before parent effects, so sonner's own subscribe effect has already run here.
      useEffect(() => markToasterMounted(), []);
      return <Toaster {...props} />;
    }
    return { default: MountedToaster };
  })
);

export function LazyToaster(props: ToasterProps) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const activate = () => setActive(true);
    activators.add(activate);
    return () => {
      activators.delete(activate);
    };
  }, []);

  if (!active) return null;
  return (
    <Suspense fallback={null}>
      <SonnerToaster {...props} />
    </Suspense>
  );
}

export function showToastLazy(
  message: string,
  variant: ToastVariants,
  options?: number | ExternalToast
): Promise<string | number> {
  return whenToasterReady()
    .then(() => import("./showToast"))
    .then(({ showToast }) => showToast(message, variant, options));
}

export const __testing = {
  reset() {
    activators.clear();
    readyWaiters.length = 0;
    mountedToasters = 0;
  },
};
