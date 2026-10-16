import { describe, expect, it } from "vitest";
import { maskRecipient, recipientDomains } from "./maskRecipient";

describe("maskRecipient", () => {
  it("keeps the first two chars of the local part", () => {
    expect(maskRecipient("ahmedwasfie@awstreams.com")).toBe("ah***@awstreams.com");
  });

  it("masks display-name and multi-recipient forms", () => {
    expect(maskRecipient('"Ahmed W" <ahmedwasfie@awstreams.com>, bob@x.io')).toBe(
      "ah***@awstreams.com,bo***@x.io"
    );
  });

  it("handles one-char local parts and non-addresses", () => {
    expect(maskRecipient("a@b.co")).toBe("a***@b.co");
    expect(maskRecipient("not an email")).toBe("***");
    expect(maskRecipient("")).toBe("");
  });
});

describe("recipientDomains", () => {
  it("returns only the lower-cased domain", () => {
    expect(recipientDomains("ahmedwasfie@AWstreams.com")).toBe("awstreams.com");
  });

  it("de-duplicates across display-name and multi-recipient forms", () => {
    expect(recipientDomains('"Ahmed W" <ahmed@awstreams.com>, bob@x.io, eve@awstreams.com')).toBe(
      "awstreams.com,x.io"
    );
  });

  it("returns '-' when there is no address", () => {
    expect(recipientDomains("")).toBe("-");
    expect(recipientDomains("not an email")).toBe("-");
  });
});
