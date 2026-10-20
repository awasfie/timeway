// WC-DX-14c1: pipeline smoke story. Proves the Storybook axes (theme / locale / viewport) and axe fail mode
// on the app's real token roles before WC-DX-14c2/14c3 add the six-state stories.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

const copy = {
  en: {
    title: "Timeway tokens",
    body: "Surface, text and border roles from tokens.css and brand-timeway.css.",
  },
  ar: { title: "رموز تصميم Timeway", body: "أدوار السطح والنص والحدود من ملفات الرموز." },
} as const;

type Locale = keyof typeof copy;

function Tokens({ locale }: { locale: Locale }) {
  const t = copy[locale];
  return (
    <main>
      <section aria-labelledby="tokens-title" className="border-subtle bg-default rounded-md border p-4">
        <h1 id="tokens-title" className="text-emphasis text-lg font-semibold">
          {t.title}
        </h1>
        <p className="text-subtle mt-2 text-sm">{t.body}</p>
        <p className="bg-brand-primary mt-3 rounded-md px-3 py-2 text-sm text-white">Timeway</p>
      </section>
    </main>
  );
}

const meta = {
  title: "Foundations/Tokens",
  render: (_args, { globals }) => <Tokens locale={(globals.locale as Locale) ?? "en"} />,
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const g = (locale: Locale, theme: "light" | "dark") => ({
  brand: "timeway",
  locale,
  theme,
  viewport: { value: "mobile390", isRotated: false },
});

export const EnLight390: Story = { globals: g("en", "light") };
export const EnDark390: Story = { globals: g("en", "dark") };
export const ArLight390: Story = { globals: g("ar", "light") };
export const ArDark390: Story = {
  globals: g("ar", "dark"),
  play: async ({ canvasElement }) => {
    await expect(document.documentElement).toHaveAttribute("dir", "rtl");
    await expect(document.documentElement.classList.contains("dark")).toBe(true);
    await expect(canvasElement.querySelector("h1")?.textContent).toBe(copy.ar.title);
  },
};
