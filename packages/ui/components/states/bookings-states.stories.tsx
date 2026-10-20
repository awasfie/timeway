// WC-DX-14c2 (Q-11, WC-37): Timeway Bookings list in the six-state library ported from salesos (WC-DX-14a).
// One story per state (first-use, no-results, cleared, sparse, dense, error, loading) x {en,ar} x {light,dark} at 390,
// rendered and axe-checked in fail mode by `yarn workspace @calcom/ui test:storybook`. error (5xx + request id) and
// loading (ListSkeleton) added by WC-DX-14c2b.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Button } from "../button";
import { EmptyState, ListRow, ListSkeleton, ListState, PageError } from "./index";

type State = "first-use" | "no-results" | "cleared" | "sparse" | "dense" | "error" | "loading";
type Locale = "en" | "ar";

// en/ar from packages/i18n/locales/{en,ar}/common.json where the key exists (no_status_bookings_yet, clear_filters, ...).
const copy = {
  en: {
    list: "Bookings",
    firstUse: {
      title: "No upcoming bookings",
      body: "As soon as someone books a time with you it will show up here.",
      action: "Copy booking link",
      secondary: "New event type",
    },
    noResults: {
      title: "No results",
      body: "No bookings match these filters. Try fewer filters.",
      action: "Clear filters",
    },
    cleared: {
      title: "All caught up",
      body: "Every booking request has an answer. New ones land here.",
      action: "View upcoming",
    },
    sparse: { hint: "Share your booking link to fill the rest of your week.", action: "Copy booking link" },
    events: ["30 min meeting", "Discovery call", "Demo"],
    error: {
      what: "We couldn't load your bookings.",
      do: "Try again. If it keeps failing, share the request ID with support.",
      labels: { retry: "Retry", requestId: "Request ID", copy: "Copy", copied: "Copied!" },
    },
    loading: "Loading...",
  },
  ar: {
    list: "عمليات الحجز",
    firstUse: {
      title: "لا توجد عمليات حجز قادمة",
      body: "بمجرد أن يحجز شخص ما موعدًا معك، سيظهر هنا.",
      action: "نسخ رابط الحجز",
      secondary: "نوع حدث جديد",
    },
    noResults: {
      title: "لا نتائج",
      body: "لا توجد حجوزات تطابق عوامل التصفية هذه. جرّب عوامل أقل.",
      action: "مسح عوامل التصفية",
    },
    cleared: {
      title: "أنجزت كل شيء",
      body: "تم الرد على كل طلبات الحجز. تصل الجديدة إلى هنا.",
      action: "عرض القادم",
    },
    sparse: { hint: "شارك رابط الحجز لتملأ بقية أسبوعك.", action: "نسخ رابط الحجز" },
    events: ["اجتماع 30 دقيقة", "مكالمة تعريفية", "عرض توضيحي"],
    error: {
      what: "تعذّر تحميل عمليات الحجز.",
      do: "حاول مجددًا. إذا استمر الخطأ، شارك معرّف الطلب مع فريق الدعم.",
      labels: { retry: "إعادة المحاولة", requestId: "معرّف الطلب", copy: "نسخ", copied: "تم النسخ!" },
    },
    loading: "يجري التحميل...",
  },
} as const;

const attendees = [
  "Mona Haddad",
  "Omar Saleh",
  "Lina Farouk",
  "Karim Nasser",
  "Sara Youssef",
  "Tarek Aziz",
  "Huda Mansour",
  "Ziad Khalil",
];
const start = Date.UTC(2026, 9, 21, 6, 0);
// Shape of the x-request-id the tRPC 5xx carries (error.data.requestId, WC-DX-14c2b errorFormatter).
const requestId = "req_01JB7Q4ZK3M9V2T8XH6N5C1D0E";

function Rows({ n, locale }: { n: number; locale: Locale }) {
  const time = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Dubai",
  });
  return (
    <>
      {attendees.slice(0, n).map((name, i) => (
        <ListRow key={name}>
          <span className="min-w-0 truncate font-medium">{name}</span>
          <span className="truncate text-subtle">{copy[locale].events[i % 3]}</span>
          <span className="text-end text-subtle tabular-nums">{time.format(start + i * 90 * 60_000)}</span>
        </ListRow>
      ))}
    </>
  );
}

function BookingsState({ state, locale }: { state: State; locale: Locale }) {
  const t = copy[locale];
  switch (state) {
    case "first-use":
      return (
        <EmptyState
          variant="first-use"
          title={t.firstUse.title}
          body={t.firstUse.body}
          action={<Button>{t.firstUse.action}</Button>}
          secondaryAction={<Button color="secondary">{t.firstUse.secondary}</Button>}
        />
      );
    case "no-results":
      return (
        <EmptyState
          variant="no-results"
          title={t.noResults.title}
          body={t.noResults.body}
          action={<Button color="secondary">{t.noResults.action}</Button>}
        />
      );
    case "cleared":
      return (
        <EmptyState
          variant="cleared"
          title={t.cleared.title}
          body={t.cleared.body}
          action={<Button color="minimal">{t.cleared.action}</Button>}
        />
      );
    case "sparse":
      return (
        <ListState
          kind="sparse"
          aria-label={t.list}
          hint={t.sparse.hint}
          hintAction={<Button color="secondary">{t.sparse.action}</Button>}>
          <Rows n={2} locale={locale} />
        </ListState>
      );
    case "dense":
      return (
        <ListState kind="dense" aria-label={t.list}>
          <Rows n={8} locale={locale} />
        </ListState>
      );
    case "error":
      return (
        <PageError
          status={500}
          requestId={requestId}
          what={t.error.what}
          do={t.error.do}
          labels={t.error.labels}
          onRetry={() => undefined}
        />
      );
    case "loading":
      return <ListSkeleton rows={5} columns={3} label={t.loading} />;
  }
}

const meta = {
  title: "Bookings/List states",
  tags: ["states"],
  args: { state: "first-use" as State },
  argTypes: {
    state: {
      control: "select",
      options: ["first-use", "no-results", "cleared", "sparse", "dense", "error", "loading"],
    },
  },
  // Stories render inside <main>, as on the real page (axe `region`: all content sits in a landmark).
  decorators: [
    (Story) => (
      <main>
        <Story />
      </main>
    ),
  ],
  render: (args, { globals }) => (
    <BookingsState state={args.state} locale={(globals.locale as Locale) ?? "en"} />
  ),
} satisfies Meta<{ state: State }>;
export default meta;
type Story = StoryObj<typeof meta>;

const v = (state: State, locale: Locale, theme: "light" | "dark"): Story => ({
  name: `${state} / ${locale}/${theme}/390`,
  args: { state },
  globals: { brand: "timeway", locale, theme, viewport: { value: "mobile390", isRotated: false } },
});

export const FirstUseEnLight390 = v("first-use", "en", "light");
export const FirstUseEnDark390 = v("first-use", "en", "dark");
export const FirstUseArLight390 = v("first-use", "ar", "light");
export const FirstUseArDark390 = v("first-use", "ar", "dark");
export const NoResultsEnLight390 = v("no-results", "en", "light");
export const NoResultsEnDark390 = v("no-results", "en", "dark");
export const NoResultsArLight390 = v("no-results", "ar", "light");
export const NoResultsArDark390 = v("no-results", "ar", "dark");
export const ClearedEnLight390 = v("cleared", "en", "light");
export const ClearedEnDark390 = v("cleared", "en", "dark");
export const ClearedArLight390 = v("cleared", "ar", "light");
export const ClearedArDark390 = v("cleared", "ar", "dark");
export const SparseEnLight390 = v("sparse", "en", "light");
export const SparseEnDark390 = v("sparse", "en", "dark");
export const SparseArLight390 = v("sparse", "ar", "light");
export const SparseArDark390 = v("sparse", "ar", "dark");
export const DenseEnLight390 = v("dense", "en", "light");
export const DenseEnDark390 = v("dense", "en", "dark");
export const DenseArLight390 = v("dense", "ar", "light");
export const DenseArDark390 = v("dense", "ar", "dark");
export const ErrorEnLight390 = v("error", "en", "light");
export const ErrorEnDark390 = v("error", "en", "dark");
export const ErrorArLight390 = v("error", "ar", "light");
export const ErrorArDark390 = v("error", "ar", "dark");
export const LoadingEnLight390 = v("loading", "en", "light");
export const LoadingEnDark390 = v("loading", "en", "dark");
export const LoadingArLight390 = v("loading", "ar", "light");
export const LoadingArDark390 = v("loading", "ar", "dark");
/** Dense rows are the 32 px compact row; sparse appends the hint row after its 1-3 real rows; RTL on <html>. */
export const DenseArDark390Contract: Story = {
  ...v("dense", "ar", "dark"),
  name: "dense contract / ar/dark/390",
  play: async ({ canvasElement }) => {
    await expect(document.documentElement).toHaveAttribute("dir", "rtl");
    const rows = canvasElement.querySelectorAll('[data-row="dense"]');
    await expect(rows.length).toBe(8);
    for (const r of rows) await expect(r.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
    await expect(Math.round(rows[0].getBoundingClientRect().height)).toBeLessThan(40);
  },
};
/** 5xx error shows the request id isolated (bdi translate=no) with Copy + Retry; loading mirrors the list grid. */
export const ErrorArDark390Contract: Story = {
  ...v("error", "ar", "dark"),
  name: "error contract / ar/dark/390",
  play: async ({ canvasElement }) => {
    const alert = canvasElement.querySelector('[role="alert"][data-state="error"]');
    await expect(alert).not.toBeNull();
    await expect(alert).toHaveAttribute("data-status", "500");
    const id = canvasElement.querySelector('bdi[translate="no"]');
    await expect(id?.textContent).toBe(requestId);
  },
};
export const LoadingEnLight390Contract: Story = {
  ...v("loading", "en", "light"),
  name: "loading contract / en/light/390",
  play: async ({ canvasElement }) => {
    const status = canvasElement.querySelector('[role="status"][aria-busy="true"]');
    await expect(status).not.toBeNull();
    await expect(canvasElement.querySelectorAll("[data-list-skeleton] li").length).toBe(5);
  },
};
