import { AVATAR_FALLBACK, CAL_URL } from "@calcom/lib/constants";
import type { User } from "@calcom/prisma/client";

export const getAbsoluteAvatarUrl = (url: string): string => {
  // Same check zod's .url() does (WHATWG URL parse), without shipping zod to the booker (WC-TW-6n-4a).
  let isAbsolute = false;
  try {
    new URL(url);
    isAbsolute = true;
  } catch {
    isAbsolute = false;
  }
  return isAbsolute ? url : CAL_URL + url;
};

/**
 * Gives an organization aware avatar url for a user
 * It ensures that the wrong avatar isn't fetched by ensuring that organizationId is always passed
 * It should always return a fully formed url
 */
export const getUserAvatarUrl = (user: Pick<User, "avatarUrl"> | undefined): string => {
  if (user?.avatarUrl) {
    return getAbsoluteAvatarUrl(user.avatarUrl);
  }
  return CAL_URL + AVATAR_FALLBACK;
};
