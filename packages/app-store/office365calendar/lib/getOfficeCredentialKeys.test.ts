import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("./getOfficeAppKeys", () => ({
  getOfficeAppKeys: vi.fn().mockResolvedValue({ client_id: "app", client_secret: "app-s" }),
}));

import { getOfficeKeysForCredential, parseCredentialOverrides } from "./getOfficeCredentialKeys";

const OVR = JSON.stringify({ "12": { client_id: "soak", client_secret: "soak-s" }, "13": { client_id: "x" } });

describe("getOfficeKeysForCredential", () => {
  afterEach(() => {
    delete process.env.OFFICE365_CREDENTIAL_CLIENT_OVERRIDES;
  });

  test("listed credential uses its own app", async () => {
    process.env.OFFICE365_CREDENTIAL_CLIENT_OVERRIDES = OVR;
    await expect(getOfficeKeysForCredential(12)).resolves.toEqual({ client_id: "soak", client_secret: "soak-s" });
  });
  test("unlisted, incomplete and unset fall back to the App row", async () => {
    process.env.OFFICE365_CREDENTIAL_CLIENT_OVERRIDES = OVR;
    await expect(getOfficeKeysForCredential(99)).resolves.toEqual({ client_id: "app", client_secret: "app-s" });
    await expect(getOfficeKeysForCredential(13)).resolves.toEqual({ client_id: "app", client_secret: "app-s" });
    delete process.env.OFFICE365_CREDENTIAL_CLIENT_OVERRIDES;
    await expect(getOfficeKeysForCredential(12)).resolves.toEqual({ client_id: "app", client_secret: "app-s" });
  });
  test("malformed JSON is ignored", () => {
    expect(parseCredentialOverrides("{nope")).toEqual({});
  });
});
