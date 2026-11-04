/**
 * CC-13 (extended) Next page probes, WC-TW-7b-2: tenant B's session loads tenant A's rows by id
 * through the Next page loaders, in-process. A probe passes when B gets notFound/redirect/deny (or
 * a render that carries none of A's data) AND A's row is unchanged afterwards.
 *
 * Session injection: getServerSession and next/headers are mocked, so the pages' own session read
 * and the tRPC context they build (app/_trpc/context.ts) both see the user in `currentUserId`.
 * View components are stubbed: the probe inspects the element the page returns, not HTML.
 */
import process from "node:process";
import { BookingStatus, WebhookTriggerEvents } from "@calcom/prisma/enums";
import type { GetServerSidePropsContext } from "next";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Cc13Seed, SeededTenant } from "./seed";
import { seedCc13Tenants } from "./seed";
import { expectUnchanged, prisma } from "./trpc-harness";

let currentUserId: number | null = null;

vi.mock("@calcom/features/auth/lib/getServerSession", () => ({
  getServerSession: vi.fn(async () =>
    currentUserId
      ? {
          user: { id: currentUserId },
          upId: `usr-${currentUserId}`,
          hasValidLicense: true,
          expires: "2099-01-01",
        }
      : null
  ),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [], get: () => undefined, has: () => false }),
}));

// unstable_cache needs Next's incremental cache; in-process the loader must run uncached.
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));

vi.mock("app/_utils", () => ({ _generateMetadata: async () => ({}) }));
vi.mock("~/webhooks/views/webhook-edit-view", () => ({ EditWebhookView: () => null }));
vi.mock("@calcom/web/modules/event-types/components/EventTypeWebWrapper", () => ({
  EventTypeWebWrapper: () => null,
}));
vi.mock("~/availability/[schedule]/schedule-view", () => ({ AvailabilitySettingsWebWrapper: () => null }));

type PageFn = (p: { params: Promise<Record<string, string>>; searchParams: Promise<object> }) => unknown;

type PageOutcome =
  | { kind: "notFound" }
  | { kind: "redirect"; digest: string }
  | { kind: "threw"; code: string; message: string }
  | { kind: "rendered"; props: Record<string, unknown> };

const pageArgs = (params: Record<string, string>) => ({
  params: Promise.resolve(params),
  searchParams: Promise.resolve({}),
});

/** next/navigation notFound()/redirect() throw errors whose digest names them; those are denies. */
async function loadPage(page: PageFn, params: Record<string, string>): Promise<PageOutcome> {
  try {
    const el = (await page(pageArgs(params))) as { props?: Record<string, unknown> } | null;
    return { kind: "rendered", props: el?.props ?? {} };
  } catch (e) {
    const err = e as { digest?: string; code?: string; message?: string };
    const digest = err.digest ?? "";
    if (digest === "NEXT_NOT_FOUND" || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) {
      return { kind: "notFound" };
    }
    if (digest.startsWith("NEXT_REDIRECT")) return { kind: "redirect", digest };
    return { kind: "threw", code: err.code ?? "UNKNOWN", message: err.message ?? "" };
  }
}

/** Accepted: notFound, redirect, or a deny-coded throw. A render is a leak. */
function expectPageDenied(o: PageOutcome, denyMessage?: RegExp) {
  if (o.kind === "notFound" || o.kind === "redirect") return;
  if (o.kind === "threw") {
    const denied =
      ["NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED", "P2025"].includes(o.code) ||
      /UNAUTHORIZED|FORBIDDEN|NOT_FOUND|not found|does not exist/i.test(o.message) ||
      (!!denyMessage && denyMessage.test(o.message));
    expect({ threw: o.code, message: o.message.slice(0, 160), denied }).toMatchObject({ denied: true });
    return;
  }
  expect.fail(`page rendered for tenant B: ${JSON.stringify(o.props)?.slice(0, 200)}`);
}

let seed: Cc13Seed;
let n = 0;
const tag = (t: SeededTenant) => `cc13-${seed.runId}-${t.label.toLowerCase()}`;
const as = (t: SeededTenant | null) => {
  currentUserId = t ? t.owner.id : null;
};

const pagePath = {
  webhook: "../../app/(use-page-wrapper)/settings/(settings-layout)/developer/webhooks/[id]/page",
  eventType: "../../app/(use-page-wrapper)/event-types/[type]/page",
  schedule: "../../app/(use-page-wrapper)/availability/[schedule]/page",
};
const loadDefault = async (p: string) =>
  ((await import(/* @vite-ignore */ p)) as { default: PageFn }).default;

beforeAll(async () => {
  process.env.TW_CUSTOM_DOMAINS_ENABLED = "true";
  seed = await seedCc13Tenants();
});

afterAll(async () => {
  currentUserId = null;
  await seed?.cleanup();
});

describe("CC-13 Next pages: tenant B vs tenant A by id (WC-TW-7b-2)", () => {
  describe("settings/developer/webhooks/[id]", () => {
    it("B cannot open A's team webhook (inline membership check)", async () => {
      const page = await loadDefault(pagePath.webhook);
      const read = () => prisma.webhook.findUnique({ where: { id: seed.A.webhook.id } });
      await expectUnchanged(read, async () => {
        as(seed.B);
        expectPageDenied(await loadPage(page, { id: seed.A.webhook.id }));
      });
    });

    it("B cannot open A's personal (userId) webhook", async () => {
      const page = await loadDefault(pagePath.webhook);
      const wh = await prisma.webhook.create({
        data: {
          id: `${tag(seed.A)}-uwh${++n}`,
          userId: seed.A.owner.id,
          subscriberUrl: `https://${tag(seed.A)}.cc13.invalid/user`,
          eventTriggers: [WebhookTriggerEvents.BOOKING_CREATED],
        },
        select: { id: true },
      });
      const read = () => prisma.webhook.findUnique({ where: { id: wh.id } });
      await expectUnchanged(read, async () => {
        as(seed.B);
        expectPageDenied(await loadPage(page, { id: wh.id }));
      });
    });

    it("control: A's owner opens A's team webhook", async () => {
      const page = await loadDefault(pagePath.webhook);
      as(seed.A);
      const o = await loadPage(page, { id: seed.A.webhook.id });
      expect(o.kind).toBe("rendered");
      expect((o as { props: { webhook?: { id?: string } } }).props.webhook?.id).toBe(seed.A.webhook.id);
    });

    it("anonymous is redirected to login", async () => {
      const page = await loadDefault(pagePath.webhook);
      as(null);
      const o = await loadPage(page, { id: seed.A.webhook.id });
      expect(o.kind).toBe("redirect");
    });
  });

  describe("event-types/[type]", () => {
    // The page hardcodes permissions all-true for the editor UI; the gate is viewer.eventTypes.get.
    it("B cannot open A's event type (viewer.eventTypes.get denies before the all-true permissions)", async () => {
      const page = await loadDefault(pagePath.eventType);
      const read = () => prisma.eventType.findUnique({ where: { id: seed.A.eventType.id } });
      await expectUnchanged(read, async () => {
        as(seed.B);
        expectPageDenied(await loadPage(page, { type: String(seed.A.eventType.id) }));
      });
    });

    it("control: A's owner opens A's event type", async () => {
      const page = await loadDefault(pagePath.eventType);
      as(seed.A);
      const o = await loadPage(page, { type: String(seed.A.eventType.id) });
      expect(o.kind, JSON.stringify(o).slice(0, 300)).toBe("rendered");
      expect((o as { props: { id?: number } }).props.id).toBe(seed.A.eventType.id);
    });
  });

  describe("availability/[schedule]", () => {
    it("B cannot open A's schedule", async () => {
      const page = await loadDefault(pagePath.schedule);
      const read = () => prisma.schedule.findUnique({ where: { id: seed.A.schedule.id } });
      await expectUnchanged(read, async () => {
        as(seed.B);
        expectPageDenied(await loadPage(page, { schedule: String(seed.A.schedule.id) }));
      });
    });

    it("control: A's owner opens A's schedule", async () => {
      const page = await loadDefault(pagePath.schedule);
      as(seed.A);
      const o = await loadPage(page, { schedule: String(seed.A.schedule.id) });
      expect(o.kind, JSON.stringify(o).slice(0, 300)).toBe("rendered");
      expect((o as { props: { scheduleData?: { id?: number } } }).props.scheduleData?.id).toBe(
        seed.A.schedule.id
      );
    });
  });

  describe("booking/[uid] getServerSideProps", () => {
    const SECRET = "cc13Secret";
    let booking: { id: number; uid: string };

    beforeAll(async () => {
      const et = await prisma.eventType.create({
        data: {
          title: `${tag(seed.A)} hidden-field`,
          slug: `${tag(seed.A)}-hf${++n}`,
          length: 30,
          teamId: seed.A.team.id,
          twOrgId: seed.A.twOrg.id,
          scheduleId: seed.A.schedule.id,
          bookingFields: [
            {
              name: SECRET,
              type: "text",
              label: "Internal secret",
              required: false,
              hidden: true,
              editable: "user",
              sources: [{ id: "user", type: "user", label: "User", fieldRequired: false }],
            },
          ],
        },
        select: { id: true },
      });
      const start = new Date(Date.UTC(2030, 2, 1, 9));
      booking = await prisma.booking.create({
        data: {
          uid: `${tag(seed.A)}-hfb${++n}`,
          title: `${tag(seed.A)} hidden-field booking`,
          startTime: start,
          endTime: new Date(start.getTime() + 30 * 60_000),
          user: { connect: { id: seed.A.owner.id } },
          eventType: { connect: { id: et.id } },
          status: BookingStatus.ACCEPTED,
          twOrgId: seed.A.twOrg.id,
          responses: { name: "A guest", email: `${tag(seed.A)}-hfguest@cc13.test`, [SECRET]: "a-only" },
          attendees: {
            create: { email: `${tag(seed.A)}-hfguest@cc13.test`, name: "A guest", timeZone: "UTC" },
          },
        },
        select: { id: true, uid: true },
      });
    });

    const gssp = async (uid: string) => {
      const { getServerSideProps } = await import(
        "../../modules/bookings/views/bookings-single-view.getServerSideProps"
      );
      const ctx = { req: { headers: {}, cookies: {} }, res: {}, query: { uid }, params: { uid } };
      return (await getServerSideProps(ctx as unknown as GetServerSidePropsContext)) as {
        notFound?: true;
        props?: {
          canViewHiddenData: boolean;
          isLoggedInUserHost: boolean;
          internalNotePresets: unknown[];
          bookingInfo: { responses: Record<string, unknown> };
        };
      };
    };

    const readBooking = () =>
      prisma.booking.findUnique({
        where: { id: booking.id },
        select: { uid: true, status: true, responses: true, userId: true, twOrgId: true },
      });

    it("B (signed in) gets canViewHiddenData false and no hidden response field of A's booking", async () => {
      await expectUnchanged(readBooking, async () => {
        as(seed.B);
        const r = await gssp(booking.uid);
        if (r.notFound) return;
        expect(r.props?.canViewHiddenData).toBe(false);
        expect(r.props?.isLoggedInUserHost).toBe(false);
        expect(r.props?.internalNotePresets).toEqual([]);
        expect(r.props?.bookingInfo.responses).not.toHaveProperty(SECRET);
      });
    });

    it("anonymous gets no hidden response field of A's booking", async () => {
      await expectUnchanged(readBooking, async () => {
        as(null);
        const r = await gssp(booking.uid);
        if (r.notFound) return;
        expect(r.props?.canViewHiddenData).toBe(false);
        expect(r.props?.bookingInfo.responses).not.toHaveProperty(SECRET);
      });
    });

    it("control: A's owner (host) sees the hidden response field", async () => {
      as(seed.A);
      const r = await gssp(booking.uid);
      expect(r.props?.canViewHiddenData).toBe(true);
      expect(r.props?.bookingInfo.responses[SECRET]).toBe("a-only");
    });
  });
});
