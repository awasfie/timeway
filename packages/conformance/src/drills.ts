import type { Clock, SoakHost } from "./load.ts";
import { LAG_CAP_MS } from "./load.ts";
import type { GraphCalendarClient, GraphSubscription } from "./providers/graph.ts";
import { sendLifecycleNotification } from "./providers/graph.ts";
import type { DrillLine, LagLine, SoakStore } from "./store.ts";

export const DRILL_RECOVERY_MS = 15 * 60 * 1000;
const POLL_MS = 30_000;
const iso = (ms: number) => new Date(ms).toISOString();

export type LagProber = (host: SoakHost) => Promise<LagLine[]>;

/** Read `timeway_sync_token_invalidated_total{provider="google_calendar"}` from the WC-TW-3 scrape target. */
export async function readTokenInvalidatedTotal(opts: {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}): Promise<number | null> {
  const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}/api/metrics/calendar-sync`, {
    headers: { authorization: `Bearer ${opts.token}` },
  });
  if (!res.ok) return null;
  return parseCounter(await res.text(), "timeway_sync_token_invalidated_total", {
    provider: "google_calendar",
  });
}

export function parseCounter(body: string, name: string, labels: Record<string, string>): number | null {
  let total: number | null = null;
  for (const line of body.split("\n")) {
    if (!line.startsWith(name) || line.startsWith(`${name}_`)) continue;
    const m = /^([a-z_]+)(\{[^}]*\})?\s+([0-9.eE+-]+)/.exec(line);
    if (!m || m[1] !== name) continue;
    const set = m[2] ?? "";
    if (Object.entries(labels).every(([k, v]) => set.includes(`${k}="${v}"`)))
      total = (total ?? 0) + Number(m[3]);
  }
  return total;
}

const timedOut = (l: LagLine) => l.t1 === null;

/**
 * S6 Google 410, verify half (`run.ts drill410 --verify`). The one-row syncToken write is 4d's effect; this watches
 * soak-g1 recover with no manual action: the 410 counter moves (Timeway hit the bad token and reset it, which is
 * how a new syncToken gets stored) and fresh lag samples on soak-g1 flip inside the 900 s cap.
 */
export async function verifyGoogle410(opts: {
  store: SoakStore;
  host: SoakHost;
  probe: LagProber;
  clock: Clock;
  readCounter?: () => Promise<number | null>;
  baseline?: number | null;
}): Promise<DrillLine> {
  const started = opts.clock.now();
  const before = opts.baseline ?? (opts.readCounter ? await opts.readCounter() : null);
  let after: number | null = before;
  const samples: LagLine[] = [];
  let counterMoved = !opts.readCounter;
  while (opts.clock.now() - started < DRILL_RECOVERY_MS) {
    samples.push(...(await opts.probe(opts.host)));
    if (opts.readCounter) {
      after = await opts.readCounter();
      counterMoved = before !== null && after !== null && after > before;
    }
    const lastTwo = samples.slice(-2);
    if (counterMoved && lastTwo.length === 2 && !lastTwo.some(timedOut)) break;
    await opts.clock.sleep(POLL_MS);
  }
  const lastTwo = samples.slice(-2);
  const lagResumed = lastTwo.length === 2 && !lastTwo.some(timedOut);
  const line: DrillLine = {
    kind: "google410",
    at: iso(started),
    finishedAt: iso(opts.clock.now()),
    host: opts.host.username,
    pass: counterMoved && lagResumed,
    details: {
      method: "syncToken one-row write by WC-TW-4d; verified black-box",
      counterBefore: before,
      counterAfter: after,
      counterChecked: !!opts.readCounter,
      counterMoved,
      lagResumed,
      samples: samples.map((s) => ({ kind: s.kind, t0: s.t0, t1: s.t1 })),
    },
  };
  opts.store.append("drills", line);
  return line;
}

export const graphResourceFor = (calendarId: string) => `me/calendars/${calendarId}/events`;

function matchesResource(sub: GraphSubscription, calendarId: string): boolean {
  return sub.resource.toLowerCase().replace(/^\//, "") === graphResourceFor(calendarId).toLowerCase();
}

/**
 * S6 Graph subscriptionRemoved, fully runner-driven: delete the host's subscription at Graph, deliver the lifecycle
 * notification Graph would send, then wait up to 15 min for a new subscription on the same resource while lag
 * samples keep running. Graph lists only subscriptions created by the calling app, so SOAK_MS_CLIENT_ID must be the
 * app Timeway subscribes with.
 */
export async function runGraphSubscriptionRemoved(opts: {
  store: SoakStore;
  host: SoakHost;
  graph: Pick<GraphCalendarClient, "listSubscriptions" | "deleteSubscription">;
  timewayBaseUrl: string;
  clientState: string;
  probe: LagProber;
  clock: Clock;
  notify?: typeof sendLifecycleNotification;
}): Promise<DrillLine> {
  const started = opts.clock.now();
  const finish = (pass: boolean, details: Record<string, unknown>): DrillLine => {
    const line: DrillLine = {
      kind: "graphSubscriptionRemoved",
      at: iso(started),
      finishedAt: iso(opts.clock.now()),
      host: opts.host.username,
      pass,
      details,
    };
    opts.store.append("drills", line);
    return line;
  };

  const old = (await opts.graph.listSubscriptions()).find((s) => matchesResource(s, opts.host.calendarId));
  if (!old)
    return finish(false, { reason: "no Graph subscription for the host calendar visible to the soak app" });

  await opts.graph.deleteSubscription(old.id);
  const notified = await (opts.notify ?? sendLifecycleNotification)({
    timewayBaseUrl: opts.timewayBaseUrl,
    subscriptionId: old.id,
    clientState: opts.clientState,
    lifecycleEvent: "subscriptionRemoved",
  });

  const samples: LagLine[] = [];
  let replacement: GraphSubscription | undefined;
  while (opts.clock.now() - started < DRILL_RECOVERY_MS) {
    replacement = (await opts.graph.listSubscriptions()).find(
      (s) => matchesResource(s, opts.host.calendarId) && s.id !== old.id
    );
    if (replacement) break;
    await opts.clock.sleep(POLL_MS);
  }
  // one insert+delete pair after recovery shows the cache path still flips; LAG_CAP_MS bounds it
  samples.push(...(await opts.probe(opts.host)));
  const worst = samples.some(timedOut);
  return finish(!!replacement && !worst, {
    oldSubscriptionId: old.id,
    newSubscriptionId: replacement?.id ?? null,
    lifecycleStatus: notified.status,
    recoveredWithinMs: replacement ? opts.clock.now() - started : null,
    lagCapMs: LAG_CAP_MS,
    anyLagTimeout: worst,
    samples: samples.map((s) => ({ kind: s.kind, t0: s.t0, t1: s.t1 })),
  });
}
