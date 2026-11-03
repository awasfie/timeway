"use client";

import { createContext } from "react";
import type { AppRouterI18nContextType, I18nProviderProps } from "./AppRouterI18nProvider";
import { useI18nContextValue } from "./AppRouterI18nProvider";

export const CustomI18nContext = createContext<AppRouterI18nContextType | null>(null);

export function CustomI18nProvider({ children, ...props }: I18nProviderProps) {
  const value = useI18nContextValue(props);
  return <CustomI18nContext.Provider value={value}>{children}</CustomI18nContext.Provider>;
}
