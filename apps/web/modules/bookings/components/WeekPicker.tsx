import dayjs from "@calcom/dayjs";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { DatePicker, FamilyUIProvider } from "@family/ui";
import { parseDate } from "@internationalized/date";
import { resolveBookerCalendarProps, weekIndexToWeekdayId } from "../lib/familyCalendar";
import { getWeekStart } from "../lib/weekUtils";

interface WeekPickerProps {
  currentWeekStart: dayjs.Dayjs;
  userWeekStart: number;
  onDateChange: (date: dayjs.Dayjs) => void;
  showHijri?: boolean;
}

export function WeekPicker({
  currentWeekStart,
  userWeekStart,
  onDateChange,
  showHijri = false,
}: WeekPickerProps) {
  const { i18n } = useLocale();
  const weekEnd = currentWeekStart.add(6, "day");
  const startMonth = currentWeekStart.format("MMM");
  const endMonth = weekEnd.format("MMM");
  const year = weekEnd.format("YYYY");

  const weekRange =
    startMonth === endMonth
      ? `${startMonth} ${currentWeekStart.format("D")} - ${weekEnd.format("D")}, ${year}`
      : `${currentWeekStart.format("MMM D")} - ${weekEnd.format("MMM D")}, ${year}`;

  return (
    <FamilyUIProvider locale={i18n.language}>
      <DatePicker
        label={weekRange}
        {...resolveBookerCalendarProps(showHijri)}
        firstDayOfWeek={weekIndexToWeekdayId(userWeekStart)}
        value={parseDate(currentWeekStart.format("YYYY-MM-DD"))}
        onChange={(date) => {
          if (!date) return;
          onDateChange(getWeekStart(dayjs(date.toString()), userWeekStart));
        }}
      />
    </FamilyUIProvider>
  );
}
