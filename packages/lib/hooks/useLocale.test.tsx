import { AppRouterI18nContext } from "@calcom/web/app/AppRouterI18nProvider";
import { CustomI18nContext } from "@calcom/web/app/CustomI18nProvider";
import { renderHook } from "@testing-library/react-hooks";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
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

  it("loads the full dictionary once when a key is outside the booker subset", () => {
    vi.useFakeTimers();
    const loadAll = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppRouterI18nContext.Provider
        value={{ translations: { hello: "Hello" }, locale: "en", ns: "common", isSubset: true, loadAll }}>
        {children}
      </AppRouterI18nContext.Provider>
    );
    const { result } = renderHook(() => useLocale(), { wrapper });
    expect(result.current.t("hello")).toBe("Hello");
    vi.runAllTimers();
    expect(loadAll).not.toHaveBeenCalled();
    expect(result.current.t("not_in_subset")).toBe("not_in_subset");
    vi.runAllTimers();
    expect(loadAll).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("falls back to returning keys without any provider", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { result } = renderHook(() => useLocale());
    expect(result.current.t("some_key")).toBe("some_key");
    expect(result.current.isLocaleReady).toBe(false);
    warn.mockRestore();
  });
});
