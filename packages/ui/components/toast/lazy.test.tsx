import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { __testing, LazyToaster, showToastLazy } from "./lazy";

afterEach(() => {
  __testing.reset();
});

// showToastLazy resolves only after React has committed the lazily loaded Toaster, so it must not be
// awaited inside act() (act would hold that commit back); instead let real time pass inside act().
async function fireAndSettle(...args: Parameters<typeof showToastLazy>) {
  let done = false;
  act(() => {
    void showToastLazy(...args).then(() => {
      done = true;
    });
  });
  for (let i = 0; i < 40 && !done; i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 25)));
  }
  await act(() => new Promise((resolve) => setTimeout(resolve, 25)));
  expect(done).toBe(true);
}

describe("LazyToaster", () => {
  it("renders nothing (no sonner toaster) until a toast is requested", () => {
    const { container } = render(<LazyToaster position="bottom-right" />);
    expect(container.querySelector("[data-sonner-toaster]")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("mounts the toaster on the first toast and shows that toast, then later ones", async () => {
    render(<LazyToaster position="bottom-right" />);
    await fireAndSettle("email sent", "success");
    expect(document.querySelector("[data-sonner-toaster]")).not.toBeNull();
    expect(screen.getByTestId("toast-success").textContent).toBe("email sent");

    await fireAndSettle("broken", "error");
    expect(screen.getByTestId("toast-error").textContent).toBe("broken");
  });
});

describe("showToastLazy without a LazyToaster", () => {
  it("fires straight away so an eager Toaster elsewhere still receives it", async () => {
    const sonner = await import("sonner");
    const spy = vi.spyOn(sonner.toast, "custom");
    await showToastLazy("hello", "warning");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
