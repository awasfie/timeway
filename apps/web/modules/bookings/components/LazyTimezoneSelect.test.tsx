import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const loaded = vi.fn();

vi.mock("@calcom/web/modules/timezone/components/TimezoneSelect", () => {
  loaded();
  return {
    TimezoneSelect: (props: { value: string; defaultMenuIsOpen?: boolean }) => (
      <div data-testid="real-timezone-select" data-open={String(!!props.defaultMenuIsOpen)}>
        {props.value}
      </div>
    ),
  };
});

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

vi.mock("@calcom/ui/components/icon", () => ({
  Icon: () => null,
}));

import { LazyTimezoneSelect } from "./LazyTimezoneSelect";

describe("LazyTimezoneSelect", () => {
  // The loaded picker is cached at module level, so the locked case must run before any load.
  it("does not load the picker when the timezone is locked", async () => {
    render(<LazyTimezoneSelect value="Africa/Cairo" isDisabled onChange={vi.fn()} />);
    const trigger = screen.getByTestId("timezone-select-trigger");
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByTestId("real-timezone-select")).toBeNull());
    expect(loaded).not.toHaveBeenCalled();
  });

  it("renders the current zone without loading the picker, then loads it open on click", async () => {
    render(<LazyTimezoneSelect value="Asia/Dubai" onChange={vi.fn()} />);

    const trigger = screen.getByTestId("timezone-select-trigger");
    expect(trigger.textContent).toContain("Asia/Dubai");
    expect(loaded).not.toHaveBeenCalled();

    fireEvent.click(trigger);

    const real = await screen.findByTestId("real-timezone-select");
    expect(real.getAttribute("data-open")).toBe("true");
    expect(loaded).toHaveBeenCalledTimes(1);
  });
});
