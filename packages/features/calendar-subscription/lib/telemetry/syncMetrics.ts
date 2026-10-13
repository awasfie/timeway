/**
 * WC-TW-3 step 3: Prometheus series for the calendar sync dashboard.
 *
 * A dependency-free text exposition rather than prom-client: the series are few, and keeping
 * them on globalThis means every Next.js route bundle that imports this file shares one store.
 * Counters and the histogram are per process (Prometheus `rate()` absorbs restarts); gauges that
 * describe the database (stale calendars, channel expiries) are computed at scrape time.
 */

// Seconds. The WC-TW-4 gate is p95 < 60 s, so resolution is finest below a minute.
export const SYNC_LAG_BUCKETS_SECONDS = [
  1, 2.5, 5, 10, 15, 30, 45, 60, 90, 120, 300, 600, 1800, 3600,
] as const;

type Labels = Record<string, string>;

type HistogramState = { buckets: number[]; sum: number; count: number };

type SyncMetricsStore = {
  lag: Map<string, HistogramState>;
  tokenInvalidated: Map<string, number>;
  reconciliationDiff: Map<string, number>;
};

const STORE_KEY = Symbol.for("timeway.calendarSyncMetrics");

function store(): SyncMetricsStore {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: SyncMetricsStore };
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = { lag: new Map(), tokenInvalidated: new Map(), reconciliationDiff: new Map() };
  }
  return g[STORE_KEY];
}

function labelKey(labels: Labels): string {
  return JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
}

function parseKey(key: string): Labels {
  return Object.fromEntries(JSON.parse(key) as [string, string][]);
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function formatLabels(labels: Labels): string {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabelValue(v)}"`);
  return parts.length ? `{${parts.join(",")}}` : "";
}

function formatNumber(n: number): string {
  if (n === Number.POSITIVE_INFINITY) return "+Inf";
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6)));
}

function increment(map: Map<string, number>, labels: Labels, by = 1): void {
  if (!Number.isFinite(by) || by < 0) return;
  const key = labelKey(labels);
  map.set(key, (map.get(key) ?? 0) + by);
}

/** One observation per changed event: provider change time → our fetch time. */
export function observeSyncLag(provider: string, lagSeconds: number): void {
  if (!Number.isFinite(lagSeconds) || lagSeconds < 0) return;
  const key = labelKey({ provider });
  const s = store();
  let h = s.lag.get(key);
  if (!h) {
    h = { buckets: SYNC_LAG_BUCKETS_SECONDS.map(() => 0), sum: 0, count: 0 };
    s.lag.set(key, h);
  }
  SYNC_LAG_BUCKETS_SECONDS.forEach((le, i) => {
    if (lagSeconds <= le) h.buckets[i]++;
  });
  h.sum += lagSeconds;
  h.count++;
}

/** Provider rejected the stored sync token (Google 410 Gone) and a full resync ran. */
export function incSyncTokenInvalidated(provider: string): void {
  increment(store().tokenInvalidated, { provider });
}

export function addReconciliationDiff(
  provider: string,
  kind: "added" | "removed" | "changed",
  n: number
): void {
  increment(store().reconciliationDiff, { provider, kind }, n);
}

export type CalendarSubscriptionHealthRow = {
  provider: string;
  stale: number;
  channelsExpired: number;
  channelsExpiringWithin1h: number;
};

function counterLines(name: string, help: string, map: Map<string, number>): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} counter`];
  map.forEach((value, key) => {
    lines.push(`${name}${formatLabels(parseKey(key))} ${formatNumber(value)}`);
  });
  return lines;
}

/** Prometheus text exposition format 0.0.4. */
export function renderSyncMetrics(health: CalendarSubscriptionHealthRow[] = []): string {
  const s = store();
  const lines: string[] = [];

  lines.push(
    "# HELP timeway_sync_lag_seconds Seconds from a provider-side event change to Timeway fetching it (incremental syncs only).",
    "# TYPE timeway_sync_lag_seconds histogram"
  );
  s.lag.forEach((h, key) => {
    const labels = parseKey(key);
    SYNC_LAG_BUCKETS_SECONDS.forEach((le, i) => {
      lines.push(
        `timeway_sync_lag_seconds_bucket${formatLabels({ ...labels, le: String(le) })} ${h.buckets[i]}`
      );
    });
    lines.push(`timeway_sync_lag_seconds_bucket${formatLabels({ ...labels, le: "+Inf" })} ${h.count}`);
    lines.push(`timeway_sync_lag_seconds_sum${formatLabels(labels)} ${formatNumber(h.sum)}`);
    lines.push(`timeway_sync_lag_seconds_count${formatLabels(labels)} ${h.count}`);
  });

  lines.push(
    ...counterLines(
      "timeway_sync_token_invalidated_total",
      "Stored sync tokens the provider rejected (Google 410), each followed by a full resync.",
      s.tokenInvalidated
    ),
    ...counterLines(
      "timeway_reconciliation_diff_total",
      "Cache rows the reconciliation had to add, remove or change to match the provider.",
      s.reconciliationDiff
    )
  );

  lines.push(
    "# HELP timeway_stale_calendars Subscribed calendars whose cache is older than 15 minutes.",
    "# TYPE timeway_stale_calendars gauge"
  );
  for (const row of health)
    lines.push(`timeway_stale_calendars${formatLabels({ provider: row.provider })} ${row.stale}`);

  lines.push(
    "# HELP timeway_calendar_channels_expiring Subscribed calendars whose provider channel has expired or expires within 1 hour.",
    "# TYPE timeway_calendar_channels_expiring gauge"
  );
  for (const row of health) {
    lines.push(
      `timeway_calendar_channels_expiring${formatLabels({ provider: row.provider, window: "expired" })} ${row.channelsExpired}`,
      `timeway_calendar_channels_expiring${formatLabels({ provider: row.provider, window: "1h" })} ${row.channelsExpiringWithin1h}`
    );
  }

  return `${lines.join("\n")}\n`;
}

/** Test seam. */
export function resetSyncMetrics(): void {
  const s = store();
  s.lag.clear();
  s.tokenInvalidated.clear();
  s.reconciliationDiff.clear();
}
