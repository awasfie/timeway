import { describe, expect, it } from "vitest";
import { currencyExponent, formatMajor, fromMinor, isGatewayCurrency, toMinor } from "./money";

describe("gateway money helper (WC-TW-13 G4)", () => {
  it.each([
    ["SAR", 2],
    ["AED", 2],
    ["EGP", 2],
    ["USD", 2],
    ["QAR", 2],
    ["KWD", 3],
    ["BHD", 3],
    ["OMR", 3],
  ])("%s has %i decimals", (currency, exponent) => {
    expect(currencyExponent(currency)).toBe(exponent);
    expect(currencyExponent(currency.toLowerCase())).toBe(exponent);
  });

  it.each([
    ["SAR", 150, 15000, "150.00"],
    ["AED", "99.99", 9999, "99.99"],
    ["EGP", 0.1, 10, "0.10"],
    ["USD", "1", 100, "1.00"],
    ["QAR", 12.5, 1250, "12.50"],
    ["KWD", "12.345", 12345, "12.345"],
    ["KWD", 1, 1000, "1.000"],
    ["BHD", 0.005, 5, "0.005"],
    ["BHD", "7.5", 7500, "7.500"],
    ["OMR", 25, 25000, "25.000"],
    ["OMR", "0.100", 100, "0.100"],
    ["AED", 0.07, 7, "0.07"],
    ["SAR", 1.15, 115, "1.15"],
    ["EGP", 19.99, 1999, "19.99"],
  ])("%s %s <-> %i minor", (currency, major, minor, formatted) => {
    expect(toMinor(major, currency)).toBe(minor);
    expect(formatMajor(minor, currency)).toBe(formatted);
    expect(fromMinor(minor, currency)).toBe(Number(formatted));
  });

  it("KWD/BHD/OMR multiply by 1000, the others by 100", () => {
    for (const currency of ["KWD", "BHD", "OMR"]) expect(toMinor(1, currency)).toBe(1000);
    for (const currency of ["SAR", "AED", "EGP", "USD", "QAR"]) expect(toMinor(1, currency)).toBe(100);
  });

  it("round-trips every minor amount without float drift", () => {
    for (const currency of ["AED", "KWD"]) {
      for (let minor = 0; minor < 5000; minor += 7) {
        expect(toMinor(fromMinor(minor, currency), currency)).toBe(minor);
      }
    }
  });

  it("rejects sub-minor precision instead of rounding", () => {
    expect(() => toMinor("1.005", "AED")).toThrow(/more than 2 decimals/);
    expect(() => toMinor(0.0001, "KWD")).toThrow(/more than 3 decimals/);
  });

  it("allows trailing zeros beyond the exponent", () => {
    expect(toMinor("1.5000", "AED")).toBe(150);
  });

  it("handles negatives (refund corrections)", () => {
    expect(toMinor("-2.250", "BHD")).toBe(-2250);
    expect(formatMajor(-2250, "BHD")).toBe("-2.250");
  });

  it("rejects unsupported currencies and junk", () => {
    expect(isGatewayCurrency("EUR")).toBe(false);
    expect(() => toMinor(1, "EUR")).toThrow(/Unsupported gateway currency/);
    expect(() => toMinor("1,00", "AED")).toThrow(/Invalid amount/);
    expect(() => toMinor(Number.NaN, "AED")).toThrow(/finite/);
    expect(() => formatMajor(1.5, "AED")).toThrow(/safe integer/);
  });
});
