import type {
  AdapterFactory,
  CalendarSubscriptionProvider,
} from "@calcom/features/calendar-subscription/adapters/AdaptersFactory";
import type {
  CalendarCredential,
  CalendarSubscriptionEventItem,
} from "@calcom/features/calendar-subscription/lib/CalendarSubscriptionPort.interface";
import { CalendarCacheEventService } from "@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventService";
import { addReconciliationDiff } from "@calcom/features/calendar-subscription/lib/telemetry/syncMetrics";
import logger from "@calcom/lib/logger";
import type { CalendarCacheEvent, SelectedCalendar } from "@calcom/prisma/client";
import { captureMessage, metrics } from "@sentry/nextjs";

const log = logger.getSubLogger({ prefix: ["CalendarReconciliationService"] });

/** Q-5: a calendar whose last successful sync is older than this is stale and must not be served from cache. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

export const isCalendarCacheStale = (syncedAt: Date | null | undefined, now: number = Date.now()): boolean =>
  !syncedAt || now - new Date(syncedAt).getTime() > STALE_AFTER_MS;

export type ReconciliationDiff = { added: number; removed: number; changed: number };

export type ReconciliationRunResult = {
  calendars: number;
  reconciled: number;
  failed: number;
  diff: ReconciliationDiff;
};

type CacheRow = Pick<CalendarCacheEvent, "externalId" | "externalEtag">;

export type CalendarReconciliationDeps = {
  adapterFactory: Pick<AdapterFactory, "get" | "getProviders">;
  selectedCalendarRepository: {
    findForReconciliation(args: {
      integrations: string[];
      staleBefore?: Date;
      take: number;
    }): Promise<SelectedCalendar[]>;
    updateSyncStatus(
      id: string,
      data: {
        syncToken?: string | null;
        syncedAt?: Date | null;
        syncErrorAt?: Date | null;
        syncErrorCount?: number | { increment: number };
      }
    ): Promise<unknown>;
  };
  calendarCacheEventRepository: {
    findManyBySelectedCalendarIdBetween(
      selectedCalendarId: string,
      start: Date,
      end: Date
    ): Promise<CacheRow[]>;
    deleteMany(events: Pick<CalendarCacheEvent, "externalId" | "selectedCalendarId">[]): Promise<unknown>;
  };
  calendarCacheEventService: Pick<CalendarCacheEventService, "handleEvents">;
  getCredential: (selectedCalendar: SelectedCalendar) => Promise<CalendarCredential | null | undefined>;
};

const keepsCacheRow = (item: CalendarSubscriptionEventItem): boolean =>
  item.busy && item.status !== "cancelled";

/**
 * WC-TW-3 step 2: full reconciliation of the calendar cache against the provider.
 *
 * Incremental sync (webhook + syncToken) can drift: a dropped notification or a lost page leaves the cache
 * wrong until the event changes again. A full window fetch is the source of truth, so reconciliation
 * replaces the cache with it and records how far the cache had drifted.
 */
export class CalendarReconciliationService {
  static NIGHTLY_BATCH = 1000;
  static ON_DEMAND_BATCH = 50;

  constructor(private deps: CalendarReconciliationDeps) {}

  /** Nightly: every subscribed calendar. */
  reconcileAll(): Promise<ReconciliationRunResult> {
    return this.run({ take: CalendarReconciliationService.NIGHTLY_BATCH, trigger: "nightly" });
  }

  /** On demand (every cron tick): only calendars whose cache is older than 15 min. */
  reconcileStale(now: Date = new Date()): Promise<ReconciliationRunResult> {
    return this.run({
      take: CalendarReconciliationService.ON_DEMAND_BATCH,
      staleBefore: new Date(now.getTime() - STALE_AFTER_MS),
      trigger: "stale",
    });
  }

  async reconcileCalendar(selectedCalendar: SelectedCalendar): Promise<ReconciliationDiff> {
    const provider = selectedCalendar.integration as CalendarSubscriptionProvider;
    const credential = await this.deps.getCredential(selectedCalendar);
    if (!credential) throw new Error(`No credential for selected calendar ${selectedCalendar.id}`);

    // No sync token forces the adapter's full window fetch.
    const full = await this.deps.adapterFactory
      .get(provider)
      .fetchEvents({ ...selectedCalendar, syncToken: null }, credential);

    const windowStart = new Date();
    windowStart.setUTCHours(0, 0, 0, 0);
    const windowEnd = new Date(windowStart);
    windowEnd.setUTCMonth(windowEnd.getUTCMonth() + CalendarCacheEventService.MONTHS_AHEAD);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);

    const cached = await this.deps.calendarCacheEventRepository.findManyBySelectedCalendarIdBetween(
      selectedCalendar.id,
      windowStart,
      windowEnd
    );
    const cachedById = new Map(cached.map((row) => [row.externalId, row.externalEtag]));
    const wanted = full.items.filter(keepsCacheRow);
    const wantedIds = new Set(wanted.map((item) => item.id));

    const diff: ReconciliationDiff = { added: 0, removed: 0, changed: 0 };
    for (const item of wanted) {
      if (!cachedById.has(item.id)) diff.added++;
      else if ((item.etag || "") !== cachedById.get(item.id)) diff.changed++;
    }
    const toRemove = cached
      .filter((row) => !wantedIds.has(row.externalId))
      .map((row) => ({ externalId: row.externalId, selectedCalendarId: selectedCalendar.id }));
    diff.removed = toRemove.length;

    await this.deps.calendarCacheEventRepository.deleteMany(toRemove);
    await this.deps.calendarCacheEventService.handleEvents(selectedCalendar, full.items);
    await this.deps.selectedCalendarRepository.updateSyncStatus(selectedCalendar.id, {
      syncToken: full.syncToken || selectedCalendar.syncToken,
      syncedAt: new Date(),
      syncErrorAt: null,
      syncErrorCount: 0,
    });

    for (const [kind, value] of Object.entries(diff) as [keyof ReconciliationDiff, number][]) {
      metrics.distribution("calendar.reconciliation.diff", value, { attributes: { provider, kind } });
      addReconciliationDiff(provider, kind, value);
    }
    return diff;
  }

  private async run({
    take,
    staleBefore,
    trigger,
  }: {
    take: number;
    staleBefore?: Date;
    trigger: "nightly" | "stale";
  }): Promise<ReconciliationRunResult> {
    const calendars = await this.deps.selectedCalendarRepository.findForReconciliation({
      integrations: this.deps.adapterFactory.getProviders(),
      staleBefore,
      take,
    });
    const result: ReconciliationRunResult = {
      calendars: calendars.length,
      reconciled: 0,
      failed: 0,
      diff: { added: 0, removed: 0, changed: 0 },
    };
    const failedIds: string[] = [];

    // Sequential on purpose: one calendar at a time keeps provider quota use flat.
    for (const selectedCalendar of calendars) {
      try {
        const diff = await this.reconcileCalendar(selectedCalendar);
        result.reconciled++;
        result.diff.added += diff.added;
        result.diff.removed += diff.removed;
        result.diff.changed += diff.changed;
      } catch (error) {
        result.failed++;
        failedIds.push(selectedCalendar.id);
        log.error("Reconciliation failed", { selectedCalendarId: selectedCalendar.id, error });
        metrics.count("calendar.reconciliation.error", 1, {
          attributes: { provider: selectedCalendar.integration, trigger },
        });
        await this.deps.selectedCalendarRepository
          .updateSyncStatus(selectedCalendar.id, {
            syncErrorAt: new Date(),
            syncErrorCount: { increment: 1 },
          })
          .catch(() => undefined);
      }
    }

    metrics.gauge("calendar.reconciliation.stale_calendars", result.failed, { attributes: { trigger } });
    if (result.failed > 0) {
      // Q-OB alert source: a calendar that could not be brought back to fresh stays stale.
      captureMessage("calendar.subscription.stale", {
        level: "warning",
        tags: { trigger },
        extra: { count: result.failed, selectedCalendarIds: failedIds.slice(0, 50) },
      });
    }
    log.info("Reconciliation run", { trigger, ...result });
    return result;
  }
}
