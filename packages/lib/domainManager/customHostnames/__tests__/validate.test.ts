import { describe, expect, it } from "vitest";
import { normalizeHostname, validateCustomHostname } from "../validate";

describe("validateCustomHostname", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["acme.com", "apex_not_allowed"],
    ["acme.co.uk", "apex_not_allowed"],
    ["timeway.co", "reserved_domain"],
    ["book.timeway.co", "reserved_domain"],
    ["deep.book.timeway.co", "reserved_domain"],
    ["x.spenai.net", "reserved_domain"],
    ["x.awstreams.co", "reserved_domain"],
    ["*.acme.com", "wildcard"],
    ["*.timeway.co", "wildcard"],
    ["book.*.acme.com", "wildcard"],
    ["192.168.1.10", "ip_address"],
    ["8.8.8.8", "ip_address"],
    ["[::1]", "ip_address"],
    ["localhost", "not_a_hostname"],
    ["book_x.acme.com", "not_a_hostname"],
    ["-book.acme.com", "not_a_hostname"],
    ["book-.acme.com", "not_a_hostname"],
    ["book..acme.com", "not_a_hostname"],
    ["https://book.acme.com", "not_a_hostname"],
    ["book.acme.com/path", "not_a_hostname"],
    ["book.acme.notarealtld", "unknown_suffix"],
    [`${"a".repeat(64)}.acme.com`, "not_a_hostname"],
    [`${"a.".repeat(127)}com`, "too_long"],
  ])("rejects %j as %s", (input, reason) => {
    expect(validateCustomHostname(input)).toEqual({ ok: false, reason });
  });

  it.each([
    ["book.acme.com", "book.acme.com"],
    ["BOOK.Acme.COM", "book.acme.com"],
    ["book.acme.com.", "book.acme.com"],
    ["  Book.Acme.Com.  ", "book.acme.com"],
    ["book.acme.co.uk", "book.acme.co.uk"],
    ["a.b.acme.com", "a.b.acme.com"],
    ["book.timeway.com", "book.timeway.com"],
  ])("accepts %j as %s", (input, hostname) => {
    expect(validateCustomHostname(input)).toEqual({ ok: true, hostname });
  });
});

describe("normalizeHostname", () => {
  it("lowercases, trims and strips one trailing dot", () => {
    expect(normalizeHostname(" Book.Acme.Com. ")).toBe("book.acme.com");
    expect(normalizeHostname("book.acme.com")).toBe("book.acme.com");
  });
});
