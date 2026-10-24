import { renderHook } from "@testing-library/react-hooks";
import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AppRouterI18nContext } from "@calcom/web/app/AppRouterI18nProvider";
import { CustomI18nContext } from "@calcom/web/app/CustomI18nProvider";

import { PagesRouterI18nContext } from "./PagesRouterI18nContext";
import { useLocale } from "./useLocale";

vi.mock("@calcom/atoms/hooks/useAtomsContext", () => ({ useAtomsContext: () => null }));

describe("useLocale", () => {
  it("translates from the app-router context", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppRouterI18nContext.Provider value={{ translations: { hello: "Hello" }, locale: "en", ns: "common" }}>
        {children}
      </AppRouterI18nContext.Provider>
    );
    const { result } = renderHook(() => useLocale(), { wrapper });
    expect(result.current.t("hello")).toBe("Hello");
    expect(result.current.isLocaleReady).toBe(true);
  });

  it("prefers the custom (interfaceLanguage) context inside the app router", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppRouterI18nContext.Provider value={{ translations: { hello: "Hello" }, locale: "en", ns: "common" }}>
        <CustomI18nContext.Provider value={{ translations: { hello: "مرحبا" }, locale: "ar", ns: "common" }}>
          {children}
        </CustomI18nContext.Provider>
      </AppRouterI18nContext.Provider>
    );
    const { result } = renderHook(() => useLocale(), { wrapper });
    expect(result.current.t("hello")).toBe("مرحبا");
  });

  it("uses the pages-router context when there is no app-router context", () => {
    const i18n = createInstance();
    i18n.init({ lng: "en", resources: { en: { common: { hello: "Hi from pages" } } } });
    const value = { i18n, t: i18n.getFixedT("en", "common"), isLocaleReady: true };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PagesRouterI18nContext.Provider value={value}>{children}</PagesRouterI18nContext.Provider>
    );
    const { result } = renderHook(() => useLocale(), { wrapper });
    expect(result.current).toBe(value);
    expect(result.current.t("hello")).toBe("Hi from pages");
  });

  it("falls back to returning keys without any provider", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { result } = renderHook(() => useLocale());
    expect(result.current.t("some_key")).toBe("some_key");
    expect(result.current.isLocaleReady).toBe(false);
    warn.mockRestore();
  });
});
