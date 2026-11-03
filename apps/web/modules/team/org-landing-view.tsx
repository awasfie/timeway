import type { OrgLanding, OrgLandingLink } from "@calcom/lib/domainManager/customHostnames/orgLanding";
import type { TFunction } from "i18next";

type Props = { landing: OrgLanding; t: TFunction };

function LinkList({ links, t, testId }: { links: OrgLandingLink[]; t: TFunction; testId: string }) {
  return (
    <ul className="border-subtle divide-subtle divide-y rounded-md border" data-testid={testId}>
      {links.map((link) => (
        <li key={link.href}>
          <a
            href={link.href}
            className="hover:bg-cal-muted flex items-center justify-between gap-4 p-4 transition"
            data-testid="org-landing-link">
            <span className="text-emphasis text-sm font-semibold">{link.title}</span>
            <span className="text-subtle text-xs">{t("org_landing_duration", { count: link.length })}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** WC-TW-12f: server-rendered org landing (custom-host "/" and /team/<orgSlug>). */
export default function OrgLandingView({ landing, t }: Props) {
  const { org, teamLinks, members } = landing;
  const isEmpty = teamLinks.length === 0 && members.length === 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-12" data-testid="org-landing">
      <header
        className="border-subtle bg-default mb-8 flex items-center gap-4 rounded-xl border p-6"
        style={org.accentColor ? { borderTop: `4px solid ${org.accentColor}` } : undefined}>
        {org.logoUrl ? (
          // biome-ignore lint/performance/noImgElement: tenant logo from an arbitrary https origin; next/image would need every host allow-listed
          <img src={org.logoUrl} alt={org.name} className="h-14 w-14 rounded-md object-contain" />
        ) : (
          <div
            aria-hidden="true"
            className="bg-emphasis text-inverted flex h-14 w-14 items-center justify-center rounded-md text-xl font-semibold"
            style={org.accentColor ? { backgroundColor: org.accentColor } : undefined}>
            {org.name.trim().charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="font-cal text-emphasis text-2xl" data-testid="org-landing-name">
            {org.name}
          </h1>
          <p className="text-subtle text-sm">{t("org_landing_book_meeting")}</p>
        </div>
      </header>

      {teamLinks.length > 0 && (
        <section className="mb-8">
          <h2 className="text-default mb-3 text-sm font-semibold">{t("org_landing_team_links")}</h2>
          <LinkList links={teamLinks} t={t} testId="org-landing-team" />
        </section>
      )}

      {members.length > 0 && (
        <section>
          <h2 className="text-default mb-3 text-sm font-semibold">{t("team_members")}</h2>
          <div className="space-y-6" data-testid="org-landing-members">
            {members.map((m) => (
              <div key={m.username}>
                <a href={m.href} className="text-emphasis mb-2 block text-base font-medium hover:underline">
                  {m.name}
                </a>
                <LinkList links={m.links} t={t} testId="org-landing-member-links" />
              </div>
            ))}
          </div>
        </section>
      )}

      {isEmpty && (
        <p className="text-subtle text-center text-sm" data-testid="org-landing-empty">
          {t("org_landing_empty")}
        </p>
      )}
    </main>
  );
}
