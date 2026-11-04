import type { EventTypeCustomInput } from "@calcom/prisma/client";
import { describe, expect, it } from "vitest";
import { handleCustomInputs } from "./handleCustomInputs";

// Server keeps full (max) phone metadata; the booking page lazy-loads the same validator.
const phoneInput = { label: "Mobile", type: "PHONE", required: true } as EventTypeCustomInput;

describe("handleCustomInputs PHONE", () => {
  const cases: [country: string, valid: string, truncated: string][] = [
    ["EG", "+201001234567", "+20100123"],
    ["SA", "+966501234567", "+96650123"],
    ["AE", "+971501234567", "+97150123"],
  ];
  for (const [country, valid, truncated] of cases) {
    it(`accepts a valid ${country} mobile`, () => {
      expect(() => handleCustomInputs([phoneInput], [{ label: "Mobile", value: valid }])).not.toThrow();
    });
    it(`rejects a truncated ${country} mobile`, () => {
      expect(() => handleCustomInputs([phoneInput], [{ label: "Mobile", value: truncated }])).toThrow();
    });
  }
});
