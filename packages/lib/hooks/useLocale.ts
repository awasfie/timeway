import { useAtomsContext } from "@calcom/atoms/hooks/useAtomsContext";
import { AppRouterI18nContext } from "@calcom/web/app/AppRouterI18nProvider";
import { CustomI18nContext } from "@calcom/web/app/CustomI18nProvider";
import type { i18n, TFunction } from "i18next";
import { createInstance } from "i18next";
import { useContext } from "react";
import { PagesRouterI18nContext } from "./PagesRouterI18nContext";

type useLocaleReturnType = {
  i18n: i18n;
  t: TFunction;
  isLocaleReady: boolean;
};

// @internal
let fallbackLocale: useLocaleReturnType | null = null;

// No provider at all (e.g. isolated renders): keys render as-is, like react-i18next without an instance.
const getFallbackLocale = (): useLocaleReturnType => {
  if (!fallbackLocale) {
    const i18n = createInstance();
    i18n.init({ lng: "en", resources: {} });
    fallbackLocale = { i18n, t: i18n.getFixedT("en", "common"), isLocaleReady: false };
  }
  return fallbackLocale;
};

// @internal
const serverI18nInstances = new Map();

export const useLocale = (): useLocaleReturnType => {
  const appRouterContext = useContext(AppRouterI18nContext);
  const customI18nContext = useContext(CustomI18nContext);
  const pagesRouterContext = useContext(PagesRouterI18nContext);
  const atomsContext = useAtomsContext();

  if (appRouterContext) {
    const { translations, locale, ns } = customI18nContext ?? appRouterContext;
    const instanceKey = `${locale}-${ns}`;

    // Check if we already have an instance for this locale and namespace
    if (!serverI18nInstances.has(instanceKey)) {
      const i18n = createInstance();
      i18n.init({
        lng: locale,
        resources: {
          [locale]: {
            [ns]: translations,
          },
        },
      });

      serverI18nInstances.set(instanceKey, {
        t: i18n.getFixedT(locale, ns),
        isLocaleReady: true,
        i18n,
      });
    }

    return serverI18nInstances.get(instanceKey);
  }

  if (atomsContext?.clientId) {
    return {
      i18n: atomsContext.i18n,
      t: atomsContext.t,
      isLocaleReady: true,
    } as unknown as useLocaleReturnType;
  }

  if (pagesRouterContext) return pagesRouterContext;

  console.warn(
    "useLocale hook is being used outside of App Router - hence this hook will use a global, client-side i18n which can cause a small flicker"
  );
  return getFallbackLocale();
};
