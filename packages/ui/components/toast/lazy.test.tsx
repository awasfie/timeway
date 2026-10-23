import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { __testing, LazyToaster, showToastLazy } from "./lazy";

afterEach(() => {
  __testing.reset();
});

describe("LazyToaster", () => {
  it("renders nothing (no sonner toaster) until a toast is requested", () => {
    const { container } = render(<LazyToaster position="bottom-right" />);
    expect(container.querySelector("[data-sonner-toaster]")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("mounts the toaster on the first toast and shows that toast", async () => {
    render(<LazyToaster position="bottom-right" />);
    await act(async () => {
      await showToastLazy("email sent", "success");
    });
    await waitFor(() => expect(screen.getByTestId("toast-success").textContent).toBe("email sent"));
    expect(document.querySelector("[data-sonner-toaster]")).not.toBeNull();
  });

  it("shows error toasts after the toaster is already mounted", async () => {
    render(<LazyToaster position="bottom-right" />);
    await act(async () => {
      await showToastLazy("first", "success");
    });
    await act(async () => {
      await showToastLazy("broken", "error");
    });
    await waitFor(() => expect(screen.getByTestId("toast-error").textContent).toBe("broken"));
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
