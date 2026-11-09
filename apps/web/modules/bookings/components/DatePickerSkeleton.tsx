const WEEKS = 6;
const DAYS = 7;

/** Same box as the @family/ui month grid in `.tw-booker-calendar` (header, weekday row, square day cells, Hijri toggle). */
export const DatePickerSkeleton = () => (
  <div className="tw-booker-calendar" aria-busy="true" data-testid="booker-date-picker-skeleton">
    <div className="mb-2 flex h-8 items-center justify-between gap-2">
      <div className="h-8 w-8 animate-pulse rounded-md bg-subtle" />
      <div className="h-4 w-28 animate-pulse rounded bg-subtle" />
      <div className="h-8 w-8 animate-pulse rounded-md bg-subtle" />
    </div>
    <div className="grid grid-cols-7 gap-0">
      {Array.from({ length: DAYS }, (_, i) => (
        <div key={`w${i}`} className="mx-auto h-6 w-6" />
      ))}
      {Array.from({ length: WEEKS * DAYS }, (_, i) => (
        <div key={i} className="mx-auto aspect-square w-full max-w-[3.5rem] p-1">
          <div className="h-full w-full animate-pulse rounded-full bg-subtle" />
        </div>
      ))}
    </div>
    <div className="mt-2 h-4" />
  </div>
);
