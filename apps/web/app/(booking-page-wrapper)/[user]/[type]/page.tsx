import { getAvailableSlotsService } from "@calcom/features/di/containers/AvailableSlots";
import { loadTranslations } from "@calcom/i18n/server";
import { WEBAPP_URL } from "@calcom/lib/constants";
import type { ContextForGetSchedule } from "@calcom/trpc/server/routers/viewer/slots/types";
import { getScheduleSchema } from "@calcom/trpc/server/routers/viewer/slots/types";
import { buildInitialScheduleInput, getMultipleDurationValue } from "@lib/booking/initialSlots";
import { formatServerTiming, getTimings } from "@lib/booking/requestTiming";
import { buildLegacyCtx, decodeParams } from "@lib/buildLegacyCtx";
import { getServerSideProps } from "@server/lib/[user]/[type]/getServerSideProps";
import type { PageProps } from "app/_types";
import { generateMeetingMetadata } from "app/_utils";
import { CustomI18nProvider } from "app/CustomI18nProvider";
import { withAppDirSsr } from "app/WithAppDirSsr";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import type React from "react";
import { cache, Suspense } from "react";
import superjson from "superjson";
import type { PageProps as LegacyPageProps } from "~/users/views/users-type-public-view";
import LegacyPage from "~/users/views/users-type-public-view";
import SeedScheduleQuery from "~/users/views/SeedScheduleQuery";

type LegacyCtx = ReturnType<typeof buildLegacyCtx>;

const getDataUncached: (ctx: ReturnType<typeof buildLegacyCtx>) => Promise<LegacyPageProps> =
  withAppDirSsr<LegacyPageProps>(getServerSideProps);

// React cache() memoises by argument identity, so key on serialised params: page and generateMetadata
// then share one getServerSideProps execution per request (WC-TW-6a decision 1).
const getDataByKey = cache(
  async (paramsKey: string, searchParamsKey: string): Promise<{ props: LegacyPageProps; ctx: LegacyCtx }> => {
    const ctx = buildLegacyCtx(
      await headers(),
      await cookies(),
      JSON.parse(paramsKey),
      JSON.parse(searchParamsKey)
    );
    return { props: await getDataUncached(ctx), ctx };
  }
);

const getData = async (params: PageProps["params"], searchParams: PageProps["searchParams"]) =>
  getDataByKey(JSON.stringify(await params), JSON.stringify(await searchParams));

const toURLSearchParams = (searchParams: Record<string, string | string[] | undefined>) => {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) for (const v of value) sp.append(key, v);
    else if (value !== undefined) sp.set(key, value);
  }
  return sp;
};

type BookerViewProps = { props: LegacyPageProps; locale?: string | null; translations?: Record<string, string> };

const BookerView = ({ props, locale, translations }: BookerViewProps) => {
  if (!locale || !translations) return <LegacyPage {...props} />;
  return (
    <CustomI18nProvider translations={translations} locale={locale} ns="common">
      <LegacyPage {...props} />
    </CustomI18nProvider>
  );
};

/** Starts the first-month slots fetch; null when the Booker would not request the same query. */
const startSlotsFetch = ({
  props,
  ctx,
  headerList,
  searchParams,
}: {
  props: LegacyPageProps;
  ctx: LegacyCtx;
  headerList: Awaited<ReturnType<typeof headers>>;
  searchParams: URLSearchParams;
}) => {
  const eventData = props.eventData;
  if (!eventData || eventData.team) return null;
  const eventTimeZone = eventData.schedule?.timeZone ?? "UTC";
  const cfTimeZone = headerList.get("cf-timezone");
  const timeZone = searchParams.get("cal.tz") || cfTimeZone || eventTimeZone;
  const input = buildInitialScheduleInput({
    user: props.user,
    slug: props.slug,
    searchParams,
    timeZone,
    browserTimeZone: cfTimeZone || eventTimeZone,
    orgSlug: eventData.entity?.orgSlug,
    duration: getMultipleDurationValue(
      eventData.metadata?.multipleDuration,
      searchParams.get("duration"),
      eventData.length
    ),
    isTeamEvent: false,
    defaultLayout: eventData.metadata?.bookerLayouts?.defaultLayout,
  });
  if (!input) return null;
  const parsed = getScheduleSchema.safeParse(input);
  if (!parsed.success) return null;
  const start = performance.now();
  const promise = getAvailableSlotsService()
    .getAvailableSlots({ input: parsed.data, ctx: { req: ctx.req as ContextForGetSchedule["req"] } })
    .then((data) => ({ data, ms: performance.now() - start }));
  return { input, promise };
};

const SeededBooker = async ({
  props,
  slots,
  timings,
  translations,
}: {
  props: LegacyPageProps;
  translations?: Record<string, string>;
  slots: NonNullable<ReturnType<typeof startSlotsFetch>>;
  timings: Record<string, number>;
}) => {
  const locale = props.eventData?.interfaceLanguage;
  try {
    const { data, ms } = await slots.promise;
    const header = formatServerTiming({ ...timings, slots: Math.round(ms * 10) / 10 });
    return (
      <>
        <script type="application/json" id="booking-server-timing" dangerouslySetInnerHTML={{ __html: JSON.stringify({ serverTiming: header }) }} />
        <SeedScheduleQuery input={slots.input} serializedData={superjson.serialize(data)}>
          <BookerView props={props} locale={locale} translations={translations} />
        </SeedScheduleQuery>
      </>
    );
  } catch {
    // Slots failure must never break the page: the Booker fetches on its own.
    return <BookerView props={props} locale={locale} translations={translations} />;
  }
};

// React 18 JSX types reject async components; Next renders them fine.
const SeededBookerView = SeededBooker as unknown as (p: Parameters<typeof SeededBooker>[0]) => JSX.Element;

const ServerPage = async ({ params, searchParams }: PageProps): Promise<JSX.Element> => {
  const { props, ctx } = await getData(params, searchParams);
  const locale = props.eventData?.interfaceLanguage;
  const translations = locale ? await loadTranslations(locale, "common") : undefined;
  const slots = startSlotsFetch({
    props,
    ctx,
    headerList: await headers(),
    searchParams: toURLSearchParams(await searchParams),
  });
  if (!slots) return <BookerView props={props} locale={locale} translations={translations} />;

  return (
    <Suspense fallback={<BookerView props={props} locale={locale} translations={translations} />}>
      <SeededBookerView props={props} slots={slots} timings={getTimings(ctx)} translations={translations} />
    </Suspense>
  );
};

export const generateMetadata = async ({ params, searchParams }: PageProps): Promise<Metadata> => {
  const props = await getData(params, searchParams);

  const { booking, isSEOIndexable = true, eventData, isBrandingHidden } = pageProps;
  const rescheduleUid = booking?.uid;
  const profileName = eventData?.profile?.name ?? "";
  const title = eventData?.title ?? "";
  const meeting = {
    title,
    profile: { name: profileName, image: eventData?.profile.image },
    users:
      eventData?.subsetOfUsers.map((user) => ({
        name: `${user.name}`,
        username: `${user.username}`,
      })) || [],
  };
  const decodedParams = decodeParams(await params);
  const metadata = await generateMeetingMetadata(
    meeting,
    (t) => `${rescheduleUid && !!booking ? t("reschedule") : ""} ${title} | ${profileName}`,
    (t) => `${rescheduleUid ? t("reschedule") : ""} ${title}`,
    isBrandingHidden,
    WEBAPP_URL,
    `/${decodedParams.user}/${decodedParams.type}`
  );

  return {
    ...metadata,
    robots: {
      follow: !(eventData?.hidden || !isSEOIndexable),
      index: !(eventData?.hidden || !isSEOIndexable),
    },
  };
};

export default ServerPage;
