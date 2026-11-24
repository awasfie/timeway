import { useLocale } from "@calcom/lib/hooks/useLocale";

const MONTH_KEYS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;
const WEEKDAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export type BookerFirstPaintEvent = {
  title: string;
  length?: number | null;
  description?: string | null;
  profile?: { name?: string | null; image?: string | null } | null;
  subsetOfUsers?: { name?: string | null; avatarUrl?: string | null; weekStart?: string | null }[] | null;
};

export type BookerFirstPaintShellProps = {
  event: BookerFirstPaintEvent;
  /** Epoch ms from the server render. Without it the month picker is not painted (no clock read during
   * render, so server HTML and the first client render are identical). */
  now?: number | null;
};

const weekStartIndex = (weekStart?: string | null) => {
  const i = WEEKDAY_KEYS.indexOf((weekStart ?? "").toLowerCase() as (typeof WEEKDAY_KEYS)[number]);
  return i < 0 ? 0 : i;
};

/** Month grid in UTC: leading blanks, then 1..daysInMonth. Pure, so server and client agree. */
export const buildMonthGrid = (now: number, weekStart: number) => {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const blanks = (firstWeekday - weekStart + 7) % 7;
  return { year, month, today: d.getUTCDate(), blanks, daysInMonth };
};

/**
 * WC-TW-6n-4c: the booker's first paint. Rendered by the server and on the first client render from
 * server props only (event meta + the current month), with no tRPC, react-query, superjson, booker
 * store or form code; the interactive booker (BookerWebWrapper and its providers) is fetched as a lazy
 * chunk after hydration and replaces this shell. Days are inert placeholders (data-testid
 * "booker-shell-day", never "day") so nothing can be clicked before slots exist.
 */
export const BookerFirstPaintShell = ({ event, now }: BookerFirstPaintShellProps) => {
  const { t } = useLocale();
  const users = (event.subsetOfUsers ?? []).filter((u) => !!u.avatarUrl).slice(0, 4);
  const weekStart = weekStartIndex(event.subsetOfUsers?.[0]?.weekStart);
  const grid = typeof now === "number" ? buildMonthGrid(now, weekStart) : null;
  const weekdays = Array.from({ length: 7 }, (_, i) => t(WEEKDAY_KEYS[(weekStart + i) % 7]).slice(0, 3));

  return (
    <div
      data-testid="booker-ssr-shell"
      aria-busy="true"
      className="main text-default flex min-h-[100dvh] w-full flex-col items-center md:my-20 md:min-h-0">
      <div className="bg-default dark:bg-cal-muted md:border-subtle flex w-full max-w-full flex-col md:w-auto md:flex-row md:rounded-md md:border">
        <div className="relative z-10 w-full p-6 md:w-[280px]">
          {users.length > 0 && (
            <div className="flex -space-x-1">
              {users.map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={u.avatarUrl ?? ""}
                  alt={u.name ?? ""}
                  width={24}
                  height={24}
                  className="border-default h-6 w-6 rounded-full border"
                />
              ))}
            </div>
          )}
          {event.profile?.name && (
            <p className="text-subtle mt-2 text-sm font-semibold">{event.profile.name}</p>
          )}
          <h1 data-testid="event-title" className="text-text my-2 break-words text-xl font-semibold">
            {event.title}
          </h1>
          {event.description && (
            <div
              className="text-default wrap-break-word line-clamp-3 text-sm [&_a]:underline"
              // Server-side markdownToSafeHTML output (getPublicEvent), same as the booker renders.
              dangerouslySetInnerHTML={{ __html: event.description }}
            />
          )}
          {!!event.length && (
            <p className="text-default mt-3 text-sm font-medium">
              {event.length} {t("minute_timeUnit")}
            </p>
          )}
        </div>
        {grid && (
          <div className="border-subtle w-full p-6 md:w-[455px] md:border-l" data-testid="booker-shell-month">
            <p className="text-emphasis mb-4 text-base font-semibold">
              {t(MONTH_KEYS[grid.month])} <span className="text-subtle font-normal">{grid.year}</span>
            </p>
            <div className="text-subtle mb-2 grid grid-cols-7 gap-1 text-center text-xs uppercase">
              {weekdays.map((w, i) => (
                <span key={i}>{w}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: grid.blanks }, (_, i) => (
                <span key={`b${i}`} />
              ))}
              {Array.from({ length: grid.daysInMonth }, (_, i) => (
                <span
                  key={i}
                  data-testid="booker-shell-day"
                  className="bg-cal-muted text-muted flex aspect-square items-center justify-center rounded-md text-sm">
                  {i + 1}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
