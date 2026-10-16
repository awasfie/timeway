import { describe, expect, it } from "vitest";
import { maskRecipient } from "./maskRecipient";

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
