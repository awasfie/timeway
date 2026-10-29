import slugify from "@calcom/lib/slugify";

// Kept apart from defaultEvents.ts so client hooks (useSchedule) do not pull the app-store zod schemas.
const arrayCast = (value: unknown | unknown[]) => {
  return Array.isArray(value) ? value : value ? [value] : [];
};

export const getUsernameList = (users: string | string[] | undefined): string[] => {
  // Multiple users can come in case of a team round-robin booking and in that case dynamic link won't be a user.
  // So, even though this code handles even if individual user is dynamic link, that isn't a possibility right now.
  users = arrayCast(users);
  const allUsers = users
    .map((user) => user.replace(/( |%20|%2b)/gi, "+").split("+"))
    .flat()
    .filter(Boolean);
  return Array.prototype.concat(...allUsers.map((userSlug) => slugify(userSlug)));
};
