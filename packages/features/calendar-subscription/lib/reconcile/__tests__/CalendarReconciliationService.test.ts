import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  metrics: { count: vi.fn(), distribution: vi.fn(), gauge: vi.fn() },
  captureMessage: vi.fn(),
}));

import type { SelectedCalendar } from "@calcom/prisma/client";
import { captureMessage, metrics } from "@sentry/nextjs";
import type { CalendarSubscriptionEventItem } from "../../CalendarSubscriptionPort.interface";
import { renderSyncMetrics, resetSyncMetrics } from "../../telemetry/syncMetrics";
import {
  type CalendarReconciliationDeps,
  CalendarReconciliationService,
  isCalendarCacheStale,
  STALE_AFTER_MS,
} from "../CalendarReconciliationService";

const calendar = (id: string, over: Partial<SelectedCalendar> = {}): SelectedCalendar =>
  ({
    id,
    userId: 1,
    credentialId: 1,
    delegationCredentialId: null,
    integration: "google_calendar",
    externalId: `${id}@example.com`,
    syncToken: "incremental-token",
    syncSubscribedAt: new Date(),
    syncedAt: new Date(),
    ...over,
  }) as SelectedCalendar;

const item = (
  id: string,
  over: Partial<CalendarSubscriptionEventItem> = {}
): CalendarSubscriptionEventItem => ({
  id,
  iCalUID: null,
  start: new Date(Date.now() + 3_600_000),
  end: new Date(Date.now() + 7_200_000),
  busy: true,
  isAllDay: false,
  summary: null,
  description: null,
  kind: null,
  etag: `etag-${id}`,
  status: "confirmed",
  location: null,
  originalStartDate: null,
  recurringEventId: null,
  timeZone: "UTC",
  createdAt: null,
  updatedAt: null,
  ...over,
});

describe("CalendarReconciliationService", () => {
  let fetchEvents: ReturnType<typeof vi.fn>;
  let deps: CalendarReconciliationDeps & {
    selectedCalendarRepository: {
      findForReconciliation: ReturnType<typeof vi.fn>;
      updateSyncStatus: ReturnType<typeof vi.fn>;
    };
    calendarCacheEventRepository: {
      findManyBySelectedCalendarIdBetween: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    calendarCacheEventService: { handleEvents: ReturnType<typeof vi.fn> };
  };
  let service: CalendarReconciliationService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSyncMetrics();
    fetchEvents = vi.fn();
    deps = {
      adapterFactory: {
        get: vi.fn().mockReturnValue({ fetchEvents }),
        getProviders: vi.fn().mockReturnValue(["google_calendar", "office365_calendar"]),
      },
      selectedCalendarRepository: {
        findForReconciliation: vi.fn().mockResolvedValue([]),
        updateSyncStatus: vi.fn().mockResolvedValue(undefined),
      },
      calendarCacheEventRepository: {
        findManyBySelectedCalendarIdBetween: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue(undefined),
      },
      calendarCacheEventService: { handleEvents: vi.fn().mockResolvedValue(undefined) },
      getCredential: vi.fn().mockResolvedValue({ id: 1 }),
    } as never;
    service = new CalendarReconciliationService(deps);
  });

  test("isCalendarCacheStale: never synced or older than 15 min is stale", () => {
    const now = Date.now();
    expect(isCalendarCacheStale(null, now)).toBe(true);
    expect(isCalendarCacheStale(new Date(now - STALE_AFTER_MS - 1), now)).toBe(true);
    expect(isCalendarCacheStale(new Date(now - STALE_AFTER_MS + 1000), now)).toBe(false);
  });

  test("full fetch ignores the stored sync token, replaces drifted rows and reports the diff", async () => {
    fetchEvents.mockResolvedValue({
      provider: "google_calendar",
      syncToken: "fresh-token",
      items: [
        item("kept"),
        item("changed", { etag: "etag-new" }),
        item("missing"),
        item("gone", { status: "cancelled" }),
      ],
    });
    deps.calendarCacheEventRepository.findManyBySelectedCalendarIdBetween.mockResolvedValue([
      { externalId: "kept", externalEtag: "etag-kept" },
      { externalId: "changed", externalEtag: "etag-old" },
      { externalId: "gone", externalEtag: "etag-gone" },
      { externalId: "orphan", externalEtag: "etag-orphan" },
    ]);

    const diff = await service.reconcileCalendar(calendar("cal-1"));

    expect(fetchEvents.mock.calls[0][0].syncToken).toBeNull();
    expect(diff).toEqual({ added: 1, removed: 2, changed: 1 });
    const prom = renderSyncMetrics();
    expect(prom).toContain('timeway_reconciliation_diff_total{kind="removed",provider="google_calendar"} 2');
    expect(prom).toContain('timeway_reconciliation_diff_total{kind="added",provider="google_calendar"} 1');
    expect(prom).toContain('timeway_reconciliation_diff_total{kind="changed",provider="google_calendar"} 1');
    expect(deps.calendarCacheEventRepository.deleteMany).toHaveBeenCalledWith([
      { externalId: "gone", selectedCalendarId: "cal-1" },
      { externalId: "orphan", selectedCalendarId: "cal-1" },
    ]);
    expect(deps.calendarCacheEventService.handleEvents).toHaveBeenCalledTimes(1);
    expect(deps.selectedCalendarRepository.updateSyncStatus).toHaveBeenCalledWith(
      "cal-1",
      expect.objectContaining({ syncToken: "fresh-token", syncedAt: expect.any(Date), syncErrorCount: 0 })
    );
  });

  test("reconcileStale asks only for calendars last synced before now - 15 min", async () => {
    const now = new Date("2026-10-13T10:00:00Z");
    await service.reconcileStale(now);
    expect(deps.selectedCalendarRepository.findForReconciliation).toHaveBeenCalledWith({
      integrations: ["google_calendar", "office365_calendar"],
      staleBefore: new Date(now.getTime() - STALE_AFTER_MS),
      take: CalendarReconciliationService.ON_DEMAND_BATCH,
    });
  });

  test("a calendar that fails stays stale: error recorded, Q-OB alert raised, others still reconciled", async () => {
    deps.selectedCalendarRepository.findForReconciliation.mockResolvedValue([
      calendar("bad"),
      calendar("good"),
    ]);
    fetchEvents
      .mockRejectedValueOnce(new Error("401 invalid_grant"))
      .mockResolvedValueOnce({ provider: "google_calendar", syncToken: "t", items: [item("a")] });

    const result = await service.reconcileAll();

    expect(result).toEqual({
      calendars: 2,
      reconciled: 1,
      failed: 1,
      diff: { added: 1, removed: 0, changed: 0 },
    });
    expect(deps.selectedCalendarRepository.updateSyncStatus).toHaveBeenCalledWith("bad", {
      syncErrorAt: expect.any(Date),
      syncErrorCount: { increment: 1 },
    });
    expect(captureMessage).toHaveBeenCalledWith(
      "calendar.subscription.stale",
      expect.objectContaining({ extra: expect.objectContaining({ count: 1, selectedCalendarIds: ["bad"] }) })
    );
    expect(metrics.count).toHaveBeenCalledWith("calendar.reconciliation.error", 1, expect.anything());
  });

  describe("office365_calendar (WC-TW-2-GRAPH-ON)", () => {
    const outlook = (id: string, over: Partial<SelectedCalendar> = {}): SelectedCalendar =>
      calendar(id, { integration: "office365_calendar", externalId: `AAMk-${id}`, ...over });

    test("nightly and stale runs ask for office365 calendars from the real factory providers", async () => {
      const { DefaultAdapterFactory } = await import("../../../adapters/AdaptersFactory");
      deps.adapterFactory.getProviders = (): string[] => new DefaultAdapterFactory().getProviders();

      await service.reconcileAll();
      await service.reconcileStale(new Date("2026-10-21T10:00:00Z"));

      expect(deps.selectedCalendarRepository.findForReconciliation).toHaveBeenCalledTimes(2);
      for (const [args] of deps.selectedCalendarRepository.findForReconciliation.mock.calls) {
        expect(args.integrations).toContain("office365_calendar");
      }
    });

    test("routes to the office365 adapter; Graph's null etag is not counted as drift", async () => {
      fetchEvents.mockResolvedValue({
        provider: "office365_calendar",
        syncToken: "graph-state",
        items: [item("o-kept", { etag: null }), item("o-new", { etag: null })],
      });
      // CalendarCacheEventService stores a null etag as "".
      deps.calendarCacheEventRepository.findManyBySelectedCalendarIdBetween.mockResolvedValue([
        { externalId: "o-kept", externalEtag: "" },
        { externalId: "o-orphan", externalEtag: "" },
      ]);

      const diff = await service.reconcileCalendar(outlook("o365-1"));

      expect(deps.adapterFactory.get).toHaveBeenCalledWith("office365_calendar");
      expect(diff).toEqual({ added: 1, removed: 1, changed: 0 });
      expect(renderSyncMetrics()).toContain(
        'timeway_reconciliation_diff_total{kind="removed",provider="office365_calendar"} 1'
      );
    });

    test("end to end with the real Graph adapter: full calendarView/delta round, @removed rows dropped", async () => {
      const { Office365CalendarSubscriptionAdapter } = await import(
        "../../../adapters/Office365CalendarSubscription.adapter"
      );
      const base = "https://graph.microsoft.com/v1.0";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          value: [
            {
              id: "g-busy",
              showAs: "busy",
              start: { dateTime: "2030-01-02T09:00:00.0000000", timeZone: "UTC" },
              end: { dateTime: "2030-01-02T10:00:00.0000000", timeZone: "UTC" },
            },
            { id: "g-removed", "@removed": { reason: "deleted" } },
          ],
          "@odata.deltaLink": `${base}/me/calendarView/delta?$deltatoken=d9`,
        }),
      });
      vi.stubGlobal("fetch", fetchMock);
      try {
        const adapter = new Office365CalendarSubscriptionAdapter({ getAccessToken: async () => "access" });
        deps.adapterFactory.get = vi.fn().mockReturnValue(adapter);
        deps.calendarCacheEventRepository.findManyBySelectedCalendarIdBetween.mockResolvedValue([
          { externalId: "g-removed", externalEtag: "" },
        ]);
        const stored = Office365CalendarSubscriptionAdapter.encodeSyncToken(
          `${base}/me/calendarView/delta?$deltatoken=old`,
          new Date(Date.now() + 88 * 86400000)
        );

        const diff = await service.reconcileCalendar(outlook("o365-2", { syncToken: stored }));

        // Reconciliation must not reuse the stored deltaLink: it starts a new window round.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = new URL(String(fetchMock.mock.calls[0][0]));
        expect(url.pathname).toBe(
          `/v1.0/me/calendars/${encodeURIComponent("AAMk-o365-2")}/calendarView/delta`
        );
        expect(url.searchParams.get("startDateTime")).toBeTruthy();
        expect(diff).toEqual({ added: 1, removed: 1, changed: 0 });
        expect(deps.calendarCacheEventRepository.deleteMany).toHaveBeenCalledWith([
          { externalId: "g-removed", selectedCalendarId: "o365-2" },
        ]);
        const update = deps.selectedCalendarRepository.updateSyncStatus.mock.calls[0][1];
        expect(Office365CalendarSubscriptionAdapter.decodeSyncToken(update.syncToken)?.deltaLink).toBe(
          `${base}/me/calendarView/delta?$deltatoken=d9`
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  test("no alert when every calendar reconciles", async () => {
    deps.selectedCalendarRepository.findForReconciliation.mockResolvedValue([calendar("good")]);
    fetchEvents.mockResolvedValue({ provider: "google_calendar", syncToken: "t", items: [] });
    await service.reconcileAll();
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
