import type { Dayjs } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import { useSlotsViewOnSmallScreen } from "@calcom/embed-core/embed-iframe";
import { useBookerStoreContext } from "@calcom/features/bookings/Booker/BookerStoreProvider";
import type { DatePickerClassNames } from "@calcom/features/bookings/Booker/types";
import type { Slots } from "@calcom/features/bookings/types";
import NoAvailabilityDialog from "@calcom/features/calendars/components/NoAvailabilityDialog";
import { getAvailableDatesInMonth } from "@calcom/features/calendars/lib/getAvailableDatesInMonth";
import { weekdayToWeekIndex } from "@calcom/lib/dayjs";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { User } from "@calcom/prisma/client";
import type { PeriodData } from "@calcom/types/Event";
import { useNonEmptyScheduleDays } from "@calcom/web/modules/schedules/hooks/useNonEmptyScheduleDays";
import type { CalendarHookProps } from "@family/ui";
import { Calendar, FamilyUIProvider } from "@family/ui";
import type { CalendarDate, DateValue } from "@internationalized/date";
import { parseDate } from "@internationalized/date";
import { useEffect, useId, useState } from "react";
import { shallow } from "zustand/shallow";
import { resolveBookerCalendarProps, useHijriToggle, weekIndexToWeekdayId } from "../lib/familyCalendar";

const useMoveToNextMonthOnNoAvailability = ({
  browsingDate,
  nonEmptyScheduleDays,
  onMonthChange,
  isLoading,
}: {
  browsingDate: Dayjs;
  nonEmptyScheduleDays: string[];
  isLoading: boolean;
  onMonthChange: (date: Dayjs) => void;
}) => {
  if (isLoading) {
    return {
      moveToNextMonthOnNoAvailability: () => {
        /* return noop until ready */
      },
    };
  }

  const nonEmptyScheduleDaysInBrowsingMonth = nonEmptyScheduleDays.filter((date) =>
    dayjs(date).isSame(browsingDate, "month")
  );

  const moveToNextMonthOnNoAvailability = () => {
    const currentMonth = dayjs().startOf("month").format("YYYY-MM");
    const browsingMonth = browsingDate.format("YYYY-MM");
    if (currentMonth != browsingMonth || nonEmptyScheduleDaysInBrowsingMonth.length) {
      return;
    }
    onMonthChange(browsingDate.add(1, "month"));
  };
  return {
    moveToNextMonthOnNoAvailability,
  };
};

// The e2e, embed and atom suites select on these attributes; keep them stable.
// Outside-month cells are hidden by the grid, so they carry no "day" hook (the old grid rendered blanks).
const BOOKER_NAV_HOOKS: CalendarHookProps = {
  previousButtonProps: { "data-testid": "decrementMonth" },
  nextButtonProps: { "data-testid": "incrementMonth" },
  headingProps: { "data-testid": "selected-month-label" },
};

const toCalendarDate = (date: Dayjs): CalendarDate => parseDate(date.format("YYYY-MM-DD"));
const toDayjs = (date: DateValue): Dayjs => dayjs(date.toString().slice(0, 10));

export const DatePicker = ({
  event,
  slots = {},
  isLoading,
  classNames,
  scrollToTimeSlots,
  showNoAvailabilityDialog = true,
  onDateChange,
}: {
  event: {
    data?: {
      subsetOfUsers: Pick<User, "weekStart">[];
      periodType?: PeriodData["periodType"];
      periodStartDate?: PeriodData["periodStartDate"];
      periodEndDate?: PeriodData["periodEndDate"];
      periodDays?: PeriodData["periodDays"];
      periodCountCalendarDays?: PeriodData["periodCountCalendarDays"];
      /** ISO 3166-1 alpha-2 of the event owner's org; WC-DX-8 adds it to the public event payload. */
      ownerCountryCode?: string | null;
    } | null;
  };
  slots?: Slots;
  isLoading?: boolean;
  classNames?: DatePickerClassNames;
  scrollToTimeSlots?: () => void;
  showNoAvailabilityDialog?: boolean;
  onDateChange?: () => void;
}) => {
  const { i18n, t } = useLocale();
  const hijriToggleId = useId();
  const [month, selectedDate, layout, bookingData] = useBookerStoreContext(
    (state) => [state.month, state.selectedDate, state.layout, state.bookingData],
    shallow
  );

  const [setSelectedDate, setMonth, setDayCount] = useBookerStoreContext(
    (state) => [state.setSelectedDate, state.setMonth, state.setDayCount],
    shallow
  );

  const slotsViewOnSmallScreen = useSlotsViewOnSmallScreen();
  const { showHijri, setShowHijri } = useHijriToggle(event?.data?.ownerCountryCode);

  const onMonthChange = (date: Dayjs) => {
    setMonth(date.format("YYYY-MM"));
    if (!slotsViewOnSmallScreen) {
      setSelectedDate({ date: date.format("YYYY-MM-DD") });
    }
    setDayCount(null); // Whenever the month is changed, we nullify getting X days
  };

  const nonEmptyScheduleDays = useNonEmptyScheduleDays(slots);
  const browsingDate = month ? dayjs(month) : dayjs().startOf("month");
  const loading = isLoading ?? true;

  const { moveToNextMonthOnNoAvailability } = useMoveToNextMonthOnNoAvailability({
    browsingDate,
    nonEmptyScheduleDays,
    onMonthChange,
    isLoading: loading,
  });
  moveToNextMonthOnNoAvailability();

  const isCompact = layout !== "month_view" && layout !== "mobile";

  const periodData: PeriodData = {
    ...{
      periodType: "UNLIMITED",
      periodStartDate: null,
      periodEndDate: null,
      periodDays: null,
      periodCountCalendarDays: false,
    },
    ...(event?.data && {
      periodType: event.data.periodType,
      periodStartDate: event.data.periodStartDate,
      periodEndDate: event.data.periodEndDate,
      periodDays: event.data.periodDays,
      periodCountCalendarDays: event.data.periodCountCalendarDays,
    }),
  };

  const availableDates = getAvailableDatesInMonth({
    browsingDate: browsingDate.toDate(),
    includedDates: nonEmptyScheduleDays,
  });
  const isBookingInPast = bookingData ? new Date(bookingData.endTime) < new Date() : false;

  const selectDate = (date: Dayjs | null, omitUpdatingParams?: boolean) => {
    const newDate = date === null ? null : date.format("YYYY-MM-DD");
    const dateChanged = newDate !== selectedDate;
    setSelectedDate({
      date: newDate,
      omitUpdatingParams,
      preventMonthSwitching: !isCompact, // Prevent month switching when in monthly view
    });
    if (dateChanged) onDateChange?.();
  };

  // Keeps a bookable date selected in the browsing month, as the previous month grid did.
  useEffect(() => {
    if (loading || slotsViewOnSmallScreen) return;
    const selected = selectedDate ? dayjs(selectedDate) : null;
    const selectedKey = selected?.isValid() ? selected.format("YYYY-MM-DD") : null;
    if (selectedKey && availableDates.includes(selectedKey)) {
      selectDate(dayjs(selectedKey), true);
      return;
    }
    if (availableDates.length) {
      selectDate(dayjs(availableDates[0]), !selected?.isValid());
      return;
    }
    selectDate(null);
    // availableDates is derived from month + slots; listing it would re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, month, nonEmptyScheduleDays, slotsViewOnSmallScreen]);

  const selected = selectedDate && dayjs(selectedDate).isValid() ? dayjs(selectedDate) : null;
  const weekStart = weekdayToWeekIndex(event?.data?.subsetOfUsers?.[0]?.weekStart);
  const anchor = selected?.isSame(browsingDate, "month") ? selected : browsingDate;
  const [focusedDate, setFocusedDate] = useState<CalendarDate>(() => toCalendarDate(anchor));
  // The store owns the month; keyboard focus inside it is local so arrow keys can move freely.
  useEffect(() => {
    if (!toDayjs(focusedDate).isSame(browsingDate, "month")) setFocusedDate(toCalendarDate(anchor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  return (
    <FamilyUIProvider locale={i18n.language}>
      <div
        className={`tw-booker-calendar ${classNames?.datePickerContainer ?? ""}`}
        data-testid="booker-date-picker"
        aria-busy={loading}>
        <Calendar
          aria-label={t("select_date")}
          {...resolveBookerCalendarProps(showHijri)}
          {...BOOKER_NAV_HOOKS}
          cellProps={(_date, state) =>
            state.isOutsideMonth
              ? {}
              : { "data-testid": "day", "data-disabled": String(state.isDisabled || state.isUnavailable) }
          }
          cellContent={(date) => {
            const daySlots = slots[date.toString()] ?? [];
            const allAway = daySlots.length > 0 && daySlots.every((slot) => slot.away);
            if (!allAway) return undefined;
            return <span data-testid="away-emoji">{daySlots.find((slot) => slot.away)?.emoji}</span>;
          }}
          firstDayOfWeek={weekIndexToWeekdayId(weekStart)}
          value={selected ? toCalendarDate(selected) : null}
          focusedValue={focusedDate}
          onFocusChange={(date) => {
            setFocusedDate(parseDate(date.toString().slice(0, 10)));
            const next = toDayjs(date);
            if (!next.isSame(browsingDate, "month")) onMonthChange(next.startOf("month"));
          }}
          minValue={toCalendarDate(dayjs().startOf("month"))}
          isDisabled={loading}
          isDateUnavailable={(date) => !availableDates.includes(date.toString())}
          onChange={(date) => {
            selectDate(toDayjs(date));
            scrollToTimeSlots?.();
          }}
        />
        <label htmlFor={hijriToggleId} className="text-subtle mt-2 flex items-center gap-2 text-xs">
          <input
            id={hijriToggleId}
            type="checkbox"
            data-testid="booker-hijri-toggle"
            checked={showHijri}
            onChange={(e) => setShowHijri(e.target.checked)}
          />
          {t("show_hijri_dates")}
        </label>
        {!loading && !isBookingInPast && availableDates.length === 0 && showNoAvailabilityDialog && (
          <NoAvailabilityDialog
            month={new Intl.DateTimeFormat(i18n.language, { month: "long" }).format(browsingDate.toDate())}
            nextMonthButton={() => onMonthChange(browsingDate.add(1, "month"))}
            browsingDate={browsingDate}
            periodData={periodData}
          />
        )}
      </div>
    </FamilyUIProvider>
  );
};
