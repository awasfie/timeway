import process from "node:process";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// The auth gate runs before any dependency is touched, so every heavy module is replaced by a stub
// whose methods throw: a request that gets past the gate fails loudly instead of returning a 2xx.
const reached = vi.fn(() => {
  throw new Error("handler body reached past the cron auth gate");
});
// "then" must stay undefined or the module loader treats the stub as a thenable and awaits it.
const isProbe = (key: string | symbol) => typeof key === "symbol" || key === "then";
const stub = () => new Proxy({}, { get: (_t, key) => (isProbe(key) ? undefined : reached) });
// A plain function is both callable and newable, covering exported helpers and classes alike.
function stubExport() {
  reached();
}
const stubModule = () =>
  new Proxy(
    { __esModule: true },
    {
      get: (target, key) => {
        if (key in target) return target[key as keyof typeof target];
        return isProbe(key) ? undefined : stubExport;
      },
      has: (_t, key) => !isProbe(key),
    }
  );

vi.mock("@calcom/web/app/api/defaultResponderForAppDir", () => ({
  defaultResponderForAppDir: (handler: unknown) => handler,
}));
vi.mock("app/api/defaultResponderForAppDir", () => ({
  defaultResponderForAppDir: (handler: unknown) => handler,
}));
vi.mock("../../defaultResponderForAppDir", () => ({
  defaultResponderForAppDir: (handler: unknown) => handler,
}));
vi.mock("@calcom/prisma", () => ({
  __esModule: true,
  default: stub(),
  prisma: stub(),
  bookingMinimalSelect: {},
}));
vi.mock("@calcom/prisma/client", () => ({}));
vi.mock("@calcom/app-store/_appRegistry", () => stubModule());
vi.mock("@calcom/app-store/_utils/validateAppKeys", () => stubModule());
vi.mock("@calcom/app-store/delegationCredential", () => stubModule());
vi.mock("@calcom/app-store/googlecalendar/lib/CalendarService", () => stubModule());
vi.mock("@calcom/emails/email-manager", () => stubModule());
vi.mock("@calcom/emails/templates/booking-reminder-email", () => stubModule());
vi.mock("@calcom/features/bookings/lib/getCalEventResponses", () => stubModule());
vi.mock("@calcom/features/bookings/repositories/BookingRepository", () => stubModule());
vi.mock("@calcom/features/calendar-subscription/adapters/AdaptersFactory", () => stubModule());
vi.mock("@calcom/features/calendar-subscription/lib/CalendarSubscriptionService", () => stubModule());
vi.mock("@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventRepository", () => stubModule());
vi.mock("@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventService", () => stubModule());
vi.mock("@calcom/features/calendar-subscription/lib/reconcile/CalendarReconciliationService", () =>
  stubModule()
);
vi.mock("@calcom/features/calendar-subscription/lib/sync/CalendarSyncService", () => stubModule());
vi.mock("@calcom/features/credentials/repositories/CredentialRepository", () => stubModule());
vi.mock("@calcom/features/di/containers/FeatureRepository", () => stubModule());
vi.mock("@calcom/features/di/containers/TeamFeatureRepository", () => stubModule());
vi.mock("@calcom/features/di/containers/UserFeatureRepository", () => stubModule());
vi.mock("@calcom/features/schedules/repositories/ScheduleRepository", () => stubModule());
vi.mock("@calcom/features/selectedCalendar/repositories/SelectedCalendarRepository", () => stubModule());
vi.mock("@calcom/features/webhooks/lib/handleWebhookScheduledTriggers", () => stubModule());
vi.mock("@calcom/features/tasker", () => ({ __esModule: true, default: stub() }));
vi.mock("@calcom/features/tasker/task-processor", () => stubModule());
vi.mock("@calcom/i18n/server", () => stubModule());

type RouteHandler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

type RouteCase = {
  name: string;
  path: string;
  method: "GET" | "POST";
  rejectStatus: number;
  /** tasks/* only accept `Bearer ${CRON_SECRET}`; every cron route accepts CRON_API_KEY. */
  acceptsApiKey?: false;
  load: () => Promise<RouteHandler>;
};

// Every apps/web cron route rejects with 403; the tasker routes keep their 401.
const routes: RouteCase[] = [
  {
    name: "calendar-subscriptions",
    path: "/api/cron/calendar-subscriptions",
    method: "GET",
    rejectStatus: 403,
    load: async () => (await import("../calendar-subscriptions/route")).GET as unknown as RouteHandler,
  },
  {
    name: "calendar-subscriptions-cleanup",
    path: "/api/cron/calendar-subscriptions-cleanup",
    method: "GET",
    rejectStatus: 403,
    load: async () =>
      (await import("../calendar-subscriptions-cleanup/route")).GET as unknown as RouteHandler,
  },
  {
    name: "calendar-subscriptions-reconcile",
    path: "/api/cron/calendar-subscriptions-reconcile",
    method: "GET",
    rejectStatus: 403,
    load: async () =>
      (await import("../calendar-subscriptions-reconcile/route")).GET as unknown as RouteHandler,
  },
  {
    name: "selected-calendars",
    path: "/api/cron/selected-calendars",
    method: "GET",
    rejectStatus: 403,
    load: async () => (await import("../selected-calendars/route")).GET as unknown as RouteHandler,
  },
  {
    name: "sendBookingReminders",
    path: "/api/cron/sendBookingReminders",
    method: "POST",
    rejectStatus: 403,
    load: async () => (await import("../sendBookingReminders/route")).POST as unknown as RouteHandler,
  },
  {
    name: "bookingReminder",
    path: "/api/cron/bookingReminder",
    method: "POST",
    rejectStatus: 403,
    load: async () => (await import("../bookingReminder/route")).POST as unknown as RouteHandler,
  },
  {
    name: "changeTimeZone",
    path: "/api/cron/changeTimeZone",
    method: "POST",
    rejectStatus: 403,
    load: async () => (await import("../changeTimeZone/route")).POST as unknown as RouteHandler,
  },
  {
    name: "syncAppMeta",
    path: "/api/cron/syncAppMeta",
    method: "POST",
    rejectStatus: 403,
    load: async () => (await import("../syncAppMeta/route")).POST as unknown as RouteHandler,
  },
  {
    name: "webhookTriggers",
    path: "/api/cron/webhookTriggers",
    method: "POST",
    rejectStatus: 403,
    load: async () => (await import("../webhookTriggers/route")).POST as unknown as RouteHandler,
  },
  {
    name: "tasks/cron",
    path: "/api/tasks/cron",
    method: "GET",
    rejectStatus: 401,
    acceptsApiKey: false,
    load: async () => (await import("@calcom/features/tasker/api/cron")).GET as unknown as RouteHandler,
  },
  {
    name: "tasks/cleanup",
    path: "/api/tasks/cleanup",
    method: "GET",
    rejectStatus: 401,
    acceptsApiKey: false,
    load: async () => (await import("@calcom/features/tasker/api/cleanup")).GET as unknown as RouteHandler,
  },
];

// Past the gate a route hits a throwing stub or its own error handling; either way it is not a rejection.
const passesGate = async (route: RouteCase, init: { authorization?: string; query?: string }) => {
  try {
    const res = await call(route, init);
    return res.status !== 401 && res.status !== 403;
  } catch {
    return true;
  }
};

const call = async (route: RouteCase, init: { authorization?: string; query?: string } = {}) => {
  const url = `http://localhost${route.path}${init.query ? `?${init.query}` : ""}`;
  const headers = new Headers();
  if (init.authorization !== undefined) headers.set("authorization", init.authorization);
  const handler = await route.load();
  const req = new NextRequest(url, { method: route.method, headers });
  try {
    return await handler(req, { params: Promise.resolve({}) });
  } catch (error) {
    // selected-calendars signals rejection by throwing HttpError; defaultResponder maps it in prod.
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode) return new Response(null, { status: statusCode });
    throw error;
  }
};

describe.each(routes)("cron auth gate: $name", (route) => {
  beforeEach(() => {
    reached.mockClear();
    vi.stubEnv("CRON_API_KEY", "test-cron-api-key");
    vi.stubEnv("CRON_SECRET", "");
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test(`"Bearer undefined" is rejected with ${route.rejectStatus} while CRON_SECRET is unset`, async () => {
    expect(process.env.CRON_SECRET).toBeUndefined();
    const res = await call(route, { authorization: "Bearer undefined" });
    expect(res.status).toBe(route.rejectStatus);
    expect(reached).not.toHaveBeenCalled();
  });

  test(`"Bearer undefined" in the apiKey query param is rejected while CRON_SECRET is unset`, async () => {
    const res = await call(route, { query: "apiKey=Bearer%20undefined" });
    expect(res.status).toBe(route.rejectStatus);
    expect(reached).not.toHaveBeenCalled();
  });

  test(`"Bearer " with an empty CRON_SECRET is rejected`, async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await call(route, { authorization: "Bearer " });
    expect(res.status).toBe(route.rejectStatus);
    expect(reached).not.toHaveBeenCalled();
  });

  test("a wrong credential is rejected", async () => {
    const res = await call(route, { authorization: "wrong-key" });
    expect(res.status).toBe(route.rejectStatus);
    expect(reached).not.toHaveBeenCalled();
  });

  if (route.acceptsApiKey === false) {
    test("a valid CRON_API_KEY is not accepted", async () => {
      const res = await call(route, { authorization: "test-cron-api-key" });
      expect(res.status).toBe(route.rejectStatus);
    });

    test("a valid Bearer CRON_SECRET still passes the gate", async () => {
      vi.stubEnv("CRON_SECRET", "test-cron-secret");
      expect(await passesGate(route, { authorization: "Bearer test-cron-secret" })).toBe(true);
    });
  } else {
    test("a valid CRON_API_KEY in the authorization header still passes the gate", async () => {
      expect(await passesGate(route, { authorization: "test-cron-api-key" })).toBe(true);
    });

    test("a valid CRON_API_KEY in the apiKey query param still passes the gate", async () => {
      expect(await passesGate(route, { query: "apiKey=test-cron-api-key" })).toBe(true);
    });
  }
});
