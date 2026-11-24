import type { TFunction, i18n } from "i18next";
import { useContext } from "react";

import { useAtomsContext } from "@calcom/atoms/hooks/useAtomsContext";
import { AppRouterI18nContext } from "@calcom/web/app/AppRouterI18nProvider";
import { CustomI18nContext } from "@calcom/web/app/CustomI18nProvider";

import { createLightI18n } from "../i18n/lightI18n";
import { PagesRouterI18nContext } from "../i18n/PagesRouterI18nContext";

type useLocaleReturnType = {
  i18n: i18n;
  t: TFunction;
  isLocaleReady: boolean;
};

// @internal
const serverI18nInstances = new Map<string, useLocaleReturnType>();

/**
 * WC-TW-6n-4b: App Router pages get the request locale's strings from the root layout (resolved on the
 * server) and translate them with the dependency-free lightI18n, so i18next and react-i18next are no
 * longer on the booking first load. Pages Router pages read react-i18next through
 * PagesRouterI18nContext (provided by lib/app-providers.tsx); platform atoms alias their own hook.
 */
export const useLocale = (): useLocaleReturnType => {
  const appRouterContext = useContext(AppRouterI18nContext);
  const customI18nContext = useContext(CustomI18nContext);
  const pagesRouterContext = useContext(PagesRouterI18nContext);
  const atomsContext = useAtomsContext();

  if (atomsContext?.clientId) {
    return {
      i18n: atomsContext.i18n,
      t: atomsContext.t,
      isLocaleReady: true,
    } as unknown as useLocaleReturnType;
  }

  if (appRouterContext) {
    const { translations, locale, ns } = customI18nContext ?? appRouterContext;
    const instanceKey = `${locale}-${ns}`;
    let instance = serverI18nInstances.get(instanceKey);
    if (!instance) {
      const { t, i18n } = createLightI18n(locale, ns, translations);
      instance = { t, i18n, isLocaleReady: true };
      serverI18nInstances.set(instanceKey, instance);
    }
    return instance;
  }

  if (pagesRouterContext) {
    return {
      t: pagesRouterContext.t,
      i18n: pagesRouterContext.i18n,
      isLocaleReady: Object.keys(pagesRouterContext.i18n).length > 0,
    };
  }

  console.warn("useLocale hook is being used outside of an i18n provider - returning keys untranslated");
  const fallback = createLightI18n("en", "common", {});
  return { t: fallback.t, i18n: fallback.i18n, isLocaleReady: false };
};
