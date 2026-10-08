import { describe, expect, it, vi } from "vitest";

import { withGoogleBackoff } from "../GoogleCalendarSubscription.adapter";

const httpErr = (status: number) => Object.assign(new Error(String(status)), { response: { status } });

describe("withGoogleBackoff", () => {
  it("retries 429 then succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(httpErr(429)).mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(withGoogleBackoff(fn, sleep)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("gives up after 5 retries on 403", async () => {
    const fn = vi.fn().mockRejectedValue(httpErr(403));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(withGoogleBackoff(fn, sleep)).rejects.toThrow("403");
    expect(fn).toHaveBeenCalledTimes(6);
    expect(sleep).toHaveBeenCalledTimes(5);
  });
  it("does not retry other errors", async () => {
    const fn = vi.fn().mockRejectedValue(httpErr(410));
    await expect(withGoogleBackoff(fn, vi.fn())).rejects.toThrow("410");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
