"use client";

import type { TFunction, i18n } from "i18next";
import { createContext } from "react";

/**
 * WC-TW-6n-4b: the Pages Router (next-i18next) hands its react-i18next `t`/`i18n` to useLocale through
 * this context, so useLocale itself never imports i18next or react-i18next at runtime and the App
 * Router booker's first load carries neither.
 */
export const PagesRouterI18nContext = createContext<{ t: TFunction; i18n: i18n } | null>(null);
