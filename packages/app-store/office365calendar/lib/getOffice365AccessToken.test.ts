import { beforeEach, describe, expect, test, vi } from "vitest";

const getTokenObjectOrFetch = vi.fn();
const ctorArgs: unknown[] = [];

vi.mock("../../_utils/oauth/OAuthManager", () => ({
  OAuthManager: vi.fn().mockImplementation(function (this: unknown, args: unknown) {
    ctorArgs.push(args);
    return { getTokenObjectOrFetch };
  }),
}));
vi.mock("../../_utils/oauth/oAuthManagerHelper", () => ({
  oAuthManagerHelper: {
    credentialSyncVariables: {},
    invalidateCredential: vi.fn(),
    markTokenAsExpired: vi.fn(),
    updateTokenObject: vi.fn(),
  },
}));
vi.mock("./getOfficeAppKeys", () => ({
  getOfficeAppKeys: vi.fn().mockResolvedValue({ client_id: "cid", client_secret: "cs" }),
}));

import { getOffice365AccessToken } from "./getOffice365AccessToken";

const credential = {
  id: 9,
  type: "office365_calendar",
  userId: 3,
  key: { access_token: "stored", refresh_token: "r", expiry_date: Date.now() + 3600_000 },
  delegatedTo: null,
} as never;

describe("getOffice365AccessToken", () => {
  beforeEach(() => {
    getTokenObjectOrFetch.mockReset();
    ctorArgs.length = 0;
  });

  test("returns the access token from OAuthManager (refreshing when expired)", async () => {
    getTokenObjectOrFetch.mockResolvedValue({ token: { access_token: "fresh" }, isUpdated: true });
    await expect(getOffice365AccessToken(credential)).resolves.toBe("fresh");
    expect(ctorArgs[0]).toMatchObject({
      resourceOwner: { type: "user", id: 3 },
      appSlug: "office365-calendar",
    });
  });

  test("throws when the token object has no access token", async () => {
    getTokenObjectOrFetch.mockResolvedValue({ token: {}, isUpdated: false });
    await expect(getOffice365AccessToken(credential)).rejects.toThrow("has no access token");
  });

  test("refuses delegation credentials (adapter addresses /me)", async () => {
    const delegated = {
      ...(credential as object),
      delegatedTo: { serviceAccountKey: { tenant_id: "t", client_id: "c", private_key: "k" } },
    } as never;
    await expect(getOffice365AccessToken(delegated)).rejects.toThrow(
      "delegation credential 9 is not supported"
    );
    expect(getTokenObjectOrFetch).not.toHaveBeenCalled();
  });
});
