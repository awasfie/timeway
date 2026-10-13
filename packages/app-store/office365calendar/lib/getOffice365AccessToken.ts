import type { CredentialForCalendarService } from "@calcom/types/Credential";
import { getTokenObjectFromCredential } from "../../_utils/oauth/getTokenObjectFromCredential";
import { OAuthManager } from "../../_utils/oauth/OAuthManager";
import { oAuthManagerHelper } from "../../_utils/oauth/oAuthManagerHelper";
import metadata from "../_metadata";
import { getOfficeAppKeys } from "./getOfficeAppKeys";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

/**
 * Returns a usable Microsoft Graph access token for a user-OAuth office365 credential,
 * refreshing (and persisting) it through OAuthManager exactly like Office365CalendarService does.
 *
 * WC-TW-2: the subscription adapter talks to `/me/...`, which an app-only (delegation) token
 * cannot address, so delegation credentials are refused here instead of failing later in Graph.
 */
export async function getOffice365AccessToken(credential: CredentialForCalendarService): Promise<string> {
  if (credential.delegatedTo) {
    throw new Error(
      `Office365 subscription: delegation credential ${credential.id} is not supported (needs /users/{id} addressing)`
    );
  }

  const auth = new OAuthManager({
    credentialSyncVariables: oAuthManagerHelper.credentialSyncVariables,
    resourceOwner: { type: "user", id: credential.userId },
    appSlug: metadata.slug,
    currentTokenObject: getTokenObjectFromCredential(credential),
    fetchNewTokenObject: async ({ refreshToken }: { refreshToken: string | null }) => {
      if (!refreshToken) return null;
      const { client_id, client_secret } = await getOfficeAppKeys();
      return fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          scope: "User.Read Calendars.Read Calendars.ReadWrite",
          client_id,
          client_secret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });
    },
    isTokenObjectUnusable: async () => null,
    isAccessTokenUnusable: async () => null,
    invalidateTokenObject: () => oAuthManagerHelper.invalidateCredential(credential.id),
    expireAccessToken: () => oAuthManagerHelper.markTokenAsExpired(credential),
    updateTokenObject: (tokenObject) =>
      oAuthManagerHelper.updateTokenObject({ tokenObject, credentialId: credential.id }),
  });

  const { token } = await auth.getTokenObjectOrFetch();
  if (!token?.access_token) {
    throw new Error(`Office365 subscription: credential ${credential.id} has no access token`);
  }
  return token.access_token;
}
