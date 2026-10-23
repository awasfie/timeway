import slugify from "@calcom/lib/slugify";
import { prisma } from "@calcom/prisma";

const TEAM_EVENT_PATH = /^\/team\/([^/]+)\/([^/]+)(?:\/embed)?\/?$/;

export type TeamEventPath = { teamSlug: string; eventSlug: string };

/** Matches /team/<slug>/<type> and /team/<slug>/<type>/embed, slugified like the page loader. */
export const parseTeamEventPath = (pathname: string | null | undefined): TeamEventPath | null => {
  if (!pathname) return null;
  const match = TEAM_EVENT_PATH.exec(pathname);
  if (!match) return null;
  try {
    const teamSlug = slugify(decodeURIComponent(match[1]));
    const eventSlug = slugify(decodeURIComponent(match[2]));
    if (!teamSlug || !eventSlug || eventSlug === "embed") return null;
    return { teamSlug, eventSlug };
  } catch {
    return null;
  }
};

/**
 * The event type's interfaceLanguage for a public team booking page, or null.
 * Same lookup scope as lib/team/[slug]/[type]/getServerSideProps (top-level team, no org).
 * Never throws: a failed lookup falls back to the visitor locale.
 */
export const getBookingPageLocale = async (pathname: string | null | undefined): Promise<string | null> => {
  const parsed = parseTeamEventPath(pathname);
  if (!parsed) return null;
  try {
    const eventType = await prisma.eventType.findFirst({
      where: {
        slug: parsed.eventSlug,
        team: { slug: parsed.teamSlug, parentId: null },
      },
      select: { interfaceLanguage: true },
    });
    const locale = eventType?.interfaceLanguage?.trim();
    return locale ? locale : null;
  } catch {
    return null;
  }
};
