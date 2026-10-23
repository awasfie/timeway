// Replaces next/dist/build/polyfills/polyfill-module in client bundles (turbopack alias in
// apps/web/next.config.ts). Next 16 compiles for chrome/edge/firefox 111 + safari 16.4, which ship
// every polyfill in that module natively except URL.canParse (Safari 17, Firefox 115, Chrome 120),
// so only that one stays. Lighthouse legacy-javascript flagged the rest as ~14 KiB of dead code.
if (typeof URL !== "undefined" && !("canParse" in URL)) {
  Object.defineProperty(URL, "canParse", {
    configurable: true,
    writable: true,
    value(url: string | URL, base?: string | URL): boolean {
      try {
        return !!new URL(url, base);
      } catch {
        return false;
      }
    },
  });
}

export {};
