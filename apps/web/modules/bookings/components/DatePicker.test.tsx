import dayjs from "@calcom/dayjs";
import { render } from "@calcom/features/bookings/Booker/__tests__/test-utils";
import { act, fireEvent, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { HIJRI_TOGGLE_STORAGE_KEY } from "../lib/familyCalendar";
import { DatePicker } from "./DatePicker";

vi.mock("@calcom/features/calendars/components/NoAvailabilityDialog", () => ({
  default: () => <div data-testid="no-availability-dialog" />,
}));

vi.mock("@calcom/embed-core/embed-iframe", () => ({
  useSlotsViewOnSmallScreen: () => false,
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const slotsFor = (...dates: dayjs.Dayjs[]) =>
  Object.fromEntries(dates.map((d) => [d.format("YYYY-MM-DD"), [{ time: d.format("YYYY-MM-DDTHH:mm:ss") }]]));

const saEvent = {
  data: { subsetOfUsers: [{ weekStart: "Sunday" }], ownerCountryCode: "SA" },
};

const memoryStorage = () => {
  let data: Record<string, string> = {};
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
    clear: () => {
      data = {};
    },
    key: (i: number) => Object.keys(data)[i] ?? null,
    get length() {
      return Object.keys(data).length;
    },
  };
};

describe("Booker DatePicker on @family/ui Calendar", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test("disables the grid while loading", () => {
    render(<DatePicker event={{}} isLoading={true} />);
    expect(screen.getByTestId("booker-date-picker")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("application").closest("[data-disabled]")).not.toBeNull();
  });

  test("happy path, slots in current month keep the current month", () => {
    const testDate = dayjs().add(1, "day");
    const { mockStore } = render(<DatePicker event={{}} slots={slotsFor(testDate)} isLoading={false} />);
    if (testDate.isSame(dayjs(), "month")) {
      expect(mockStore.getState().setMonth).not.toHaveBeenCalled();
      expect(mockStore.getState().setSelectedDate).toHaveBeenCalledWith(
        expect.objectContaining({ date: testDate.format("YYYY-MM-DD") })
      );
    }
  });

  test("when there are only slots in the next month, skip the current month", () => {
    const slotDate = dayjs().add(1, "month");
    const { mockStore } = render(<DatePicker event={{}} slots={slotsFor(slotDate)} isLoading={false} />, {
      mockStore: { month: dayjs().format("YYYY-MM") },
    });
    expect(mockStore.getState().setMonth).toHaveBeenCalledWith(slotDate.format("YYYY-MM"));
  });

  test("when there are no slots, skip only 1 month (no infinite loop)", () => {
    const { mockStore } = render(<DatePicker event={{}} slots={{}} isLoading={false} />, {
      mockStore: { month: dayjs().add(1, "month").format("YYYY-MM") },
    });
    expect(mockStore.getState().setMonth).not.toHaveBeenCalled();
    expect(screen.getByTestId("no-availability-dialog")).toBeInTheDocument();
  });

  test("clicking an available day selects it", () => {
    const day = dayjs().add(1, "month").date(15);
    const { mockStore } = render(<DatePicker event={{}} slots={slotsFor(day)} isLoading={false} />, {
      mockStore: { month: day.format("YYYY-MM") },
    });
    const cell = screen
      .getAllByRole("button")
      .find((b) => b.closest("td") && b.textContent?.startsWith(String(day.date())));
    act(() => {
      fireEvent.click(cell as HTMLElement);
    });
    expect(mockStore.getState().setSelectedDate).toHaveBeenCalledWith(
      expect.objectContaining({ date: day.format("YYYY-MM-DD") })
    );
  });

  test("SA org: dual Gregorian + Hijri (umalqura) day numbers are shown by default", () => {
    // 1 Ramadan 1448 = 2027-02-08 (umalqura)
    render(<DatePicker event={saEvent} slots={slotsFor(dayjs("2027-02-08"))} isLoading={false} />, {
      mockStore: { month: "2027-02" },
    });
    expect(screen.getByTestId("booker-hijri-toggle")).toBeChecked();
    const secondary = document.querySelectorAll('[data-calendar="islamic-umalqura"]');
    expect(secondary.length).toBeGreaterThanOrEqual(28);
    const feb8 = screen.getByRole("button", { name: /February 8, 2027/ });
    expect(feb8.querySelector('[data-calendar="islamic-umalqura"]')?.textContent).toBe("1");
  });

  test("SA org: Ramadan days carry data-ramadan, days before 1 Ramadan do not", () => {
    render(<DatePicker event={saEvent} slots={slotsFor(dayjs("2027-02-08"))} isLoading={false} />, {
      mockStore: { month: "2027-02" },
    });
    const feb8 = screen.getByRole("button", { name: /February 8, 2027/ });
    const feb7 = screen.getByRole("button", { name: /February 7, 2027/ });
    expect(feb8.closest("[data-ramadan]") ?? feb8.matches("[data-ramadan]")).toBeTruthy();
    expect(feb7.matches("[data-ramadan]")).toBe(false);
    // Feb 8..28 in-month; the trailing March cells are Ramadan too but sit outside the month.
    expect(document.querySelectorAll("[data-ramadan]:not([data-outside-month])").length).toBe(21);
  });

  test("non-SA org: Hijri is off by default and the toggle turns it on and persists", () => {
    render(<DatePicker event={{ data: { subsetOfUsers: [], ownerCountryCode: "AE" } }} isLoading={false} />, {
      mockStore: { month: "2027-02" },
    });
    expect(screen.getByTestId("booker-hijri-toggle")).not.toBeChecked();
    expect(document.querySelector('[data-calendar="islamic-umalqura"]')).toBeNull();
    expect(document.querySelector("[data-ramadan]")).toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId("booker-hijri-toggle"));
    });
    expect(document.querySelector('[data-calendar="islamic-umalqura"]')).not.toBeNull();
    expect(document.querySelector("[data-ramadan]")).not.toBeNull();
    expect(window.localStorage.getItem(HIJRI_TOGGLE_STORAGE_KEY)).toBe("true");
  });

  test("ArrowRight moves keyboard focus to the next day inside the month", () => {
    const day = dayjs("2027-02-10");
    render(<DatePicker event={{}} slots={slotsFor(day, day.add(1, "day"))} isLoading={false} />, {
      mockStore: { month: "2027-02", selectedDate: "2027-02-10" },
    });
    const start = screen.getByRole("button", { name: /February 10, 2027/ });
    act(() => {
      start.focus();
    });
    act(() => {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/February 11, 2027/);
  });

  test("SA org: a stored opt-out wins over the country default", () => {
    window.localStorage.setItem(HIJRI_TOGGLE_STORAGE_KEY, "false");
    render(<DatePicker event={saEvent} isLoading={false} />, { mockStore: { month: "2027-02" } });
    expect(screen.getByTestId("booker-hijri-toggle")).not.toBeChecked();
    expect(document.querySelector('[data-calendar="islamic-umalqura"]')).toBeNull();
  });

  test("keeps the e2e DOM contract: day/data-disabled, incrementMonth, decrementMonth, selected-month-label", () => {
    const day = dayjs("2027-02-16");
    render(<DatePicker event={{}} slots={slotsFor(day)} isLoading={false} />, {
      mockStore: { month: "2027-02" },
    });
    expect(document.querySelectorAll('[data-testid="day"][data-disabled="false"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="day"][data-disabled="true"]').length).toBeGreaterThan(20);
    expect(screen.getByTestId("incrementMonth")).toBeInTheDocument();
    expect(screen.getByTestId("decrementMonth")).toBeInTheDocument();
    expect(screen.getByTestId("selected-month-label")).toBeInTheDocument();
  });

  test("an all-day out-of-office date shows the away emoji in place of the day number", () => {
    const day = dayjs("2027-02-16");
    const slots = { [day.format("YYYY-MM-DD")]: [{ time: day.format("YYYY-MM-DDTHH:mm:ss"), away: true, emoji: "🏝", toUser: { id: 2 } }] };
    render(<DatePicker event={{}} slots={slots as never} isLoading={false} />, { mockStore: { month: "2027-02" } });
    expect(screen.getAllByTestId("away-emoji")).toHaveLength(1);
    expect(screen.getByTestId("away-emoji")).toHaveTextContent("🏝");
  });
});
