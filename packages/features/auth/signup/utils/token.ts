import dayjs from "@calcom/dayjs";
import { validateAndGetCorrectedUsernameInTeam } from "@calcom/features/auth/signup/utils/validateUsername";
import { emailSchema } from "@calcom/lib/emailSchema";
import { HttpError } from "@calcom/lib/http-error";
import { prisma } from "@calcom/prisma";

export async function findTokenByToken({ token }: { token: string }) {
  const foundToken = await prisma.verificationToken.findUnique({
    where: {
      token,
    },
    select: {
      id: true,
      identifier: true,
      expires: true,
      teamId: true,
    },
  });

  if (!foundToken) {
    throw new HttpError({
      statusCode: 401,
      message: "Invalid Token",
    });
  }

  return foundToken;
}

// CC13-D2: an email invite is bound to the email it was minted for, so a forwarded link cannot be
// redeemed by someone else. Invite-by-link tokens carry a non-email identifier and stay open by design.
export function tokenIdentifierMatchesEmail(identifier: string, email: string) {
  if (!emailSchema.safeParse(identifier).success) return true;
  return identifier.trim().toLowerCase() === email.trim().toLowerCase();
}

export function throwIfTokenExpired(expires?: Date) {
  if (!expires) return;
  if (dayjs(expires).isBefore(dayjs())) {
    throw new HttpError({
      statusCode: 401,
      message: "Token expired",
    });
  }
}

export async function validateAndGetCorrectedUsernameForTeam({
  username,
  email,
  teamId,
  isSignup,
}: {
  username: string;
  email: string;
  teamId: number | null;
  isSignup: boolean;
}) {
  if (!teamId) return username;

  const teamUserValidation = await validateAndGetCorrectedUsernameInTeam(username, email, teamId, isSignup);
  if (!teamUserValidation.isValid) {
    throw new HttpError({
      statusCode: 409,
      message: "Username or email is already taken",
    });
  }
  if (!teamUserValidation.username) {
    throw new HttpError({
      statusCode: 422,
      message: "Invalid username",
    });
  }
  return teamUserValidation.username;
}
