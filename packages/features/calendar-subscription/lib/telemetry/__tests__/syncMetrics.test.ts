import { beforeEach, describe, expect, it } from "vitest";
import {
  addReconciliationDiff,
  incSyncTokenInvalidated,
  observeSyncLag,
  renderSyncMetrics,
  resetSyncMetrics,
} from "../syncMetrics";

const line = (text: string, prefix: string) => text.split("\n").find((l) => l.startsWith(prefix));

describe("syncMetrics", () => {
  beforeEach(() => resetSyncMetrics());

  it("renders a cumulative lag histogram per provider", () => {
    observeSyncLag("google_calendar", 0.5);
    observeSyncLag("google_calendar", 12);
    observeSyncLag("google_calendar", 75);
    observeSyncLag("office365_calendar", 3);
    const out = renderSyncMetrics();

    expect(out).toContain("# TYPE timeway_sync_lag_seconds histogram");
    expect(line(out, 'timeway_sync_lag_seconds_bucket{provider="google_calendar",le="1"}')).toMatch(/ 1$/);
    expect(line(out, 'timeway_sync_lag_seconds_bucket{provider="google_calendar",le="15"}')).toMatch(/ 2$/);
    expect(line(out, 'timeway_sync_lag_seconds_bucket{provider="google_calendar",le="60"}')).toMatch(/ 2$/);
    expect(line(out, 'timeway_sync_lag_seconds_bucket{provider="google_calendar",le="90"}')).toMatch(/ 3$/);
    expect(line(out, 'timeway_sync_lag_seconds_bucket{provider="google_calendar",le="+Inf"}')).toMatch(/ 3$/);
    expect(line(out, 'timeway_sync_lag_seconds_sum{provider="google_calendar"}')).toMatch(/ 87.5$/);
    expect(line(out, 'timeway_sync_lag_seconds_count{provider="office365_calendar"}')).toMatch(/ 1$/);
  });

  it("ignores negative and non-finite lag (clock skew)", () => {
    observeSyncLag("google_calendar", -4);
    observeSyncLag("google_calendar", Number.NaN);
    expect(renderSyncMetrics()).not.toContain("timeway_sync_lag_seconds_count");
  });

  it("counts 410 invalidations and reconciliation diffs", () => {
    incSyncTokenInvalidated("google_calendar");
    incSyncTokenInvalidated("google_calendar");
    addReconciliationDiff("google_calendar", "removed", 3);
    addReconciliationDiff("google_calendar", "removed", 0);
    addReconciliationDiff("google_calendar", "added", 1);
    const out = renderSyncMetrics();

    expect(out).toContain("# TYPE timeway_sync_token_invalidated_total counter");
    expect(out).toContain('timeway_sync_token_invalidated_total{provider="google_calendar"} 2');
    expect(out).toContain('timeway_reconciliation_diff_total{kind="removed",provider="google_calendar"} 3');
    expect(out).toContain('timeway_reconciliation_diff_total{kind="added",provider="google_calendar"} 1');
  });

  it("renders scrape-time gauges for stale calendars and channel expiries", () => {
    const out = renderSyncMetrics([
      { provider: "google_calendar", stale: 2, channelsExpired: 1, channelsExpiringWithin1h: 4 },
      { provider: "office365_calendar", stale: 0, channelsExpired: 0, channelsExpiringWithin1h: 0 },
    ]);
    expect(out).toContain('timeway_stale_calendars{provider="google_calendar"} 2');
    expect(out).toContain('timeway_stale_calendars{provider="office365_calendar"} 0');
    expect(out).toContain(
      'timeway_calendar_channels_expiring{provider="google_calendar",window="expired"} 1'
    );
    expect(out).toContain('timeway_calendar_channels_expiring{provider="google_calendar",window="1h"} 4');
    expect(out.endsWith("\n")).toBe(true);
  });

  it("escapes label values", () => {
    incSyncTokenInvalidated('a"b\\c');
    expect(renderSyncMetrics()).toContain('timeway_sync_token_invalidated_total{provider="a\\"b\\\\c"} 1');
  });
});
