/**
 * Minor-unit conversion for every currency the gateways accept (WC-TW-13 G4).
 * Payment.amount is always minor units; providers that take major units convert here and nowhere else.
 */
export const GATEWAY_CURRENCY_EXPONENTS = {
  SAR: 2,
  AED: 2,
  EGP: 2,
  USD: 2,
  QAR: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
} as const;

export type GatewayCurrency = keyof typeof GATEWAY_CURRENCY_EXPONENTS;

export function isGatewayCurrency(currency: string): currency is GatewayCurrency {
  return Object.hasOwn(GATEWAY_CURRENCY_EXPONENTS, currency.toUpperCase());
}

export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  if (!isGatewayCurrency(code)) {
    throw new Error(`Unsupported gateway currency: ${currency}`);
  }
  return GATEWAY_CURRENCY_EXPONENTS[code];
}

const MAJOR_AMOUNT_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Major units (number or decimal string, e.g. "12.500") to integer minor units. Rejects sub-minor precision. */
export function toMinor(amount: number | string, currency: string): number {
  const exponent = currencyExponent(currency);
  const text = typeof amount === "number" ? numberToPlainString(amount) : amount.trim();
  const match = MAJOR_AMOUNT_PATTERN.exec(text);
  if (!match) {
    throw new Error(`Invalid amount for ${currency}: ${String(amount)}`);
  }
  const [, sign, whole, fraction = ""] = match;
  const significantFraction = fraction.replace(/0+$/, "");
  if (significantFraction.length > exponent) {
    throw new Error(
      `Amount ${String(amount)} has more than ${exponent} decimals for ${currency.toUpperCase()}`
    );
  }
  const minorText = `${whole}${fraction.padEnd(exponent, "0").slice(0, exponent)}`;
  const minor = Number(minorText) * (sign === "-" ? -1 : 1);
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`Amount ${String(amount)} is out of range for ${currency.toUpperCase()}`);
  }
  return minor === 0 ? 0 : minor;
}

/** Integer minor units to a major-unit number. */
export function fromMinor(minor: number, currency: string): number {
  return Number(formatMajor(minor, currency));
}

/** Integer minor units to a fixed-decimal string ("12.500" for 12500 KWD fils), for providers that take strings. */
export function formatMajor(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`Minor amount must be a safe integer, got ${String(minor)}`);
  }
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function numberToPlainString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Amount must be finite, got ${String(value)}`);
  }
  // Shortest round-trip representation, which is what the caller typed for values like 12.345.
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return value.toFixed(20).replace(/\.?0+$/, "");
}
