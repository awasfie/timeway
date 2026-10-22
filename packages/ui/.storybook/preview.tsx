// WC-DX-14c1: globals brand / theme / locale / viewport; a11y addon in fail mode.
import type { Decorator, Preview } from "@storybook/react-vite";
import { useLayoutEffect } from "react";

import "./storybook.css";
import { BRANDS, LOCALES, THEMES, VIEWPORTS, type Brand, type Locale, type Theme } from "./globals";

const withSpecAxes: Decorator = (Story, ctx) => {
  const brand = (ctx.globals.brand ?? "timeway") as Brand;
  const theme = (ctx.globals.theme ?? "light") as Theme;
  const locale = (ctx.globals.locale ?? "en") as Locale;
  const dir = locale === "ar" ? "rtl" : "ltr";
  // Timeway's dark theme is the `.dark` class on <html> (packages/config/theme/tokens.css).
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("lang", locale);
    root.setAttribute("dir", dir);
    root.setAttribute("data-brand", brand);
    root.classList.toggle("dark", theme === "dark");
  }, [brand, theme, locale, dir]);
  return (
    <div data-brand={brand} lang={locale} dir={dir} className="bg-default text-default min-h-full p-4">
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withSpecAxes],
  globalTypes: {
    brand: {
      description: "Brand pack (UX.1)",
      toolbar: { title: "Brand", icon: "paintbrush", items: [...BRANDS], dynamicTitle: true },
    },
    theme: {
      description: "Theme (.dark)",
      toolbar: { title: "Theme", icon: "mirror", items: [...THEMES], dynamicTitle: true },
    },
    locale: {
      description: "Locale + dir",
      toolbar: { title: "Locale", icon: "globe", items: [...LOCALES], dynamicTitle: true },
    },
  },
  initialGlobals: {
    brand: "timeway",
    theme: "light",
    locale: "en",
    viewport: { value: "desktop1280", isRotated: false },
  },
  parameters: {
    viewport: { options: VIEWPORTS },
    // Fail mode: any axe violation fails the story test in `yarn workspace @calcom/ui test:storybook`.
    a11y: {
      test: "error",
      options: { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    },
    controls: { matchers: { color: /(background|color)$/i } },
  },
};
export default preview;
