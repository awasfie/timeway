import { createInstance } from "i18next";
import type { TFunction, i18n } from "i18next";
import { useContext } from "react";
import { useTranslation } from "react-i18next";

import { useAtomsContext } from "@calcom/atoms/hooks/useAtomsContext";
import { AppRouterI18nContext } from "@calcom/web/app/AppRouterI18nProvider";
import { CustomI18nContext } from "@calcom/web/app/CustomI18nProvider";

type useLocaleReturnType = {
  i18n: i18n;
  t: TFunction;
  isLocaleReady: boolean;
};

// @internal
const useClientLocale = (namespace: Parameters<typeof useTranslation>[0] = "common"): useLocaleReturnType => {
  const context = useAtomsContext();
  const { i18n, t } = useTranslation(namespace);
  const isLocaleReady = Object.keys(i18n).length > 0;
  if (context?.clientId) {
    return { i18n: context.i18n, t: context.t, isLocaleReady: true } as unknown as useLocaleReturnType;
  }
  return {
    i18n,
    t,
    isLocaleReady,
  };
};

// @internal
const serverI18nInstances = new Map<
  string,
  { translations: Record<string, string>; loadAll?: () => void; value: useLocaleReturnType }
>();

export const useLocale = (): useLocaleReturnType => {
  const appRouterContext = useContext(AppRouterI18nContext);
  const customI18nContext = useContext(CustomI18nContext);
  const clientI18n = useClientLocale();

  if (appRouterContext) {
    const { translations, locale, ns, isSubset, loadAll } = customI18nContext ?? appRouterContext;
    // A subset instance is replaced once the full dictionary arrives (the context value changes).
    const instanceKey = `${locale}-${ns}-${isSubset ? "subset" : "full"}`;

    const cached = serverI18nInstances.get(instanceKey);
    if (cached?.translations !== translations || cached?.loadAll !== loadAll) {
      const i18n = createInstance();
      i18n.init({
        lng: locale,
        resources: {
          [locale]: {
            [ns]: translations,
          },
        },
        // Booker subset: a key outside it renders as the key until the full dictionary is loaded.
        ...(isSubset && loadAll
          ? {
              saveMissing: true,
              missingKeyHandler: () => {
                if (typeof window !== "undefined") setTimeout(loadAll, 0);
              },
            }
          : {}),
      });

      serverI18nInstances.set(instanceKey, {
        translations,
        loadAll,
        value: { t: i18n.getFixedT(locale, ns), isLocaleReady: true, i18n },
      });
    }

    return (serverI18nInstances.get(instanceKey) as { value: useLocaleReturnType }).value;
  }

  console.warn(
    "useLocale hook is being used outside of App Router - hence this hook will use a global, client-side i18n which can cause a small flicker"
  );
  return {
    t: clientI18n.t,
    isLocaleReady: clientI18n.isLocaleReady,
    i18n: clientI18n.i18n,
  };
};
