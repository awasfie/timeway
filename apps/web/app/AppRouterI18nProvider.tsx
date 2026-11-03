"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useMemo, useRef, useState } from "react";

export type AppRouterI18nContextType = {
  translations: Record<string, string>;
  ns: string;
  locale: string;
  /** translations is the server-built booker subset; loadAll swaps in the full dictionary. */
  isSubset?: boolean;
  loadAll?: () => void;
};

export type I18nProviderProps = Omit<AppRouterI18nContextType, "loadAll"> & { children: ReactNode };

export const AppRouterI18nContext = createContext<AppRouterI18nContextType | null>(null);

/** Context value for a provider that may start from the booker subset and load the rest on first miss. */
export function useI18nContextValue({
  translations,
  locale,
  ns,
  isSubset = false,
}: Omit<I18nProviderProps, "children">): AppRouterI18nContextType {
  const [full, setFull] = useState<Record<string, string> | null>(null);
  const requested = useRef(false);
  const loadAll = useCallback(() => {
    if (requested.current) return;
    requested.current = true;
    fetch(`/api/i18n/${encodeURIComponent(locale)}`)
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(`GET /api/i18n/${locale} ${res.status}`))
      )
      .then((all: Record<string, string>) => setFull(all))
      .catch((err) => {
        requested.current = false;
        console.error(err);
      });
  }, [locale]);

  return useMemo(
    () =>
      isSubset && !full
        ? { translations, locale, ns, isSubset: true, loadAll }
        : { translations: full ?? translations, locale, ns, isSubset: false },
    [translations, locale, ns, isSubset, full, loadAll]
  );
}

export function AppRouterI18nProvider({ children, ...props }: I18nProviderProps) {
  const value = useI18nContextValue(props);
  return <AppRouterI18nContext.Provider value={value}>{children}</AppRouterI18nContext.Provider>;
}
