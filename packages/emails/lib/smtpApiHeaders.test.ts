import { describe, expect, it } from "vitest";
import { withBookingUidSmtpApi } from "./smtpApiHeaders";

const sgHeaders = {
  "X-SMTPAPI": JSON.stringify({ filters: { bypass_list_management: { settings: { enable: 1 } } } }),
};

describe("withBookingUidSmtpApi", () => {
  it("adds unique_args.bookingUid and keeps existing filters", () => {
    const out = withBookingUidSmtpApi(sgHeaders, "bk_1");
    expect(JSON.parse(out?.["X-SMTPAPI"] ?? "{}")).toEqual({
      filters: { bypass_list_management: { settings: { enable: 1 } } },
      unique_args: { bookingUid: "bk_1" },
    });
  });

  it("leaves non-SendGrid transports and uid-less mail untouched", () => {
    expect(withBookingUidSmtpApi(undefined, "bk_1")).toBeUndefined();
    expect(withBookingUidSmtpApi({ "X-Other": "1" }, "bk_1")).toEqual({ "X-Other": "1" });
    expect(withBookingUidSmtpApi(sgHeaders, undefined)).toBe(sgHeaders);
  });

  it("does not throw on a malformed header", () => {
    const bad = { "X-SMTPAPI": "{not json" };
    expect(withBookingUidSmtpApi(bad, "bk_1")).toBe(bad);
  });
});
