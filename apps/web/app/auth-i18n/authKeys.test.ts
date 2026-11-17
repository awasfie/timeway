// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import authKeys from "./authKeys.json";
import { EXTRA_KEYS, scanKeys } from "./scanAuthKeys.mjs";

const en = JSON.parse(readFileSync(new URL("../../../../packages/i18n/locales/en/common.json", import.meta.url), "utf8"));

describe("auth page translation allow-list (UX13.3-4)", () => {
  it("covers every t(\"literal\") key in the login/signup view tree (regenerate with scanAuthKeys.mjs --write)", () => {
    const scanned = scanKeys();
    expect(scanned.filter((k) => !authKeys.includes(k))).toEqual([]);
  });

  it("has no key that is missing from common.json", () => {
    expect(authKeys.filter((k) => !(k in en))).toEqual([]);
  });

  it("includes the login error messages and the signup FEATURES table", () => {
    for (const k of [
      "incorrect_email_password",
      "incorrect_2fa_code",
      "something_went_wrong",
      "please_try_again_and_contact_us",
      "account_created_with_identity_provider",
      ...EXTRA_KEYS,
    ]) {
      expect(authKeys).toContain(k);
    }
  });

  it("is a small fraction of common.json", () => {
    expect(authKeys.length).toBeLessThan(300);
  });
});
