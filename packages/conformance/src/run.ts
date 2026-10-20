import { randomUUID } from "node:crypto";
import process from "node:process";
import { readTokenInvalidatedTotal, runGraphSubscriptionRemoved, verifyGoogle410 } from "./drills.ts";
import type { Clock, SoakHost } from "./load.ts";
import { DAY_MS, LoadRunner, MIN_LEAD_MS, realClock, runScheduler, WINDOW_MS } from "./load.ts";
import { GoogleCalendarClient } from "./providers/google.ts";
import { GraphCalendarClient } from "./providers/graph.ts";
import { formatReport, reportFromDir } from "./report.ts";
import type { BookingLine, BusyLine, DrillLine, LagLine, PingLine } from "./store.ts";
import { DEFAULT_SOAK_DIR, SoakStore } from "./store.ts";
import type { SweepHost } from "./sweep.ts";
import { previousUtcDay, runSweep } from "./sweep.ts";
import { TIMEWAY_PROD_URL, TimewayClient, TimewayHostSession } from "./timeway.ts";

export const PING_INTERVAL_MS = 5 * 60 * 1000;
/** S4/step 3: yesterday's sweep runs at 00:10 UTC, after the orphan settle of the day's last booking */
export const SWEEP_AFTER_MS = 10 * 60 * 1000;
/** S6: the Graph drill runs on soak day 5 (day 0 = SOAK_START_DAY) */
export const GRAPH_DRILL_DAY = 5;

export type HostEnv = {
  username: string;
  eventTypeId: number;
  calendarId: string;
  eventTypeSlug?: string;
  provider?: "google_calendar" | "office365_calendar";
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export function parseHosts(raw: string): HostEnv[] {
  const parsed = JSON.parse(raw) as HostEnv[];
  if (!Array.isArray(parsed) || !parsed.length) throw new Error("SOAK_HOSTS must be a non-empty JSON array");
  for (const h of parsed) {
    if (!h.username || !Number.isInteger(h.eventTypeId) || !h.calendarId)
      throw new Error(`SOAK_HOSTS entry needs username, eventTypeId, calendarId: ${h.username ?? "?"}`);
  }
  return parsed;
}

/** soak-g* hosts are Google, soak-o* Graph (S2), unless the entry names its provider. */
export function providerKind(h: HostEnv): "google_calendar" | "office365_calendar" {
  if (h.provider) return h.provider;
  return /-o\d+$/.test(h.username) ? "office365_calendar" : "google_calendar";
}

export type Runtime = {
  store: SoakStore;
  timeway: TimewayClient;
  hosts: Record<string, SoakHost>;
  sweepHosts: SweepHost[];
  graph: GraphCalendarClient | null;
  runner: LoadRunner;
  baseUrl: string;
  env: NodeJS.ProcessEnv;
  clock: Clock;
};

/** Every secret is read by env name (S8); none is logged. */
export function buildRuntime(env: NodeJS.ProcessEnv = process.env, clock: Clock = realClock): Runtime {
  const store = new SoakStore(env.SOAK_DIR ?? DEFAULT_SOAK_DIR);
  const baseUrl = env.SOAK_TIMEWAY_URL ?? TIMEWAY_PROD_URL;
  const timeway = new TimewayClient({ baseUrl });
  const hostEnvs = parseHosts(required(env, "SOAK_HOSTS"));
  const logins = env.SOAK_HOST_LOGINS
    ? (JSON.parse(env.SOAK_HOST_LOGINS) as Record<string, { email: string; password: string }>)
    : {};
  let google: GoogleCalendarClient | null = null;
  let graph: GraphCalendarClient | null = null;
  const hosts: Record<string, SoakHost> = {};
  const sweepHosts: SweepHost[] = [];
  for (const h of hostEnvs) {
    const kind = providerKind(h);
    if (kind === "google_calendar") {
      google ??= new GoogleCalendarClient({
        clientId: required(env, "SOAK_GOOGLE_CLIENT_ID"),
        clientSecret: required(env, "SOAK_GOOGLE_CLIENT_SECRET"),
        refreshToken: required(env, "SOAK_GOOGLE_REFRESH_TOKEN"),
      });
    } else {
      graph ??= new GraphCalendarClient({
        clientId: required(env, "SOAK_MS_CLIENT_ID"),
        clientSecret: required(env, "SOAK_MS_CLIENT_SECRET"),
        refreshToken: required(env, "SOAK_MS_REFRESH_TOKEN"),
      });
    }
    const provider =
      kind === "google_calendar" ? (google as GoogleCalendarClient) : (graph as GraphCalendarClient);
    hosts[h.username] = {
      username: h.username,
      eventTypeId: h.eventTypeId,
      eventTypeSlug: h.eventTypeSlug ?? "soak-30",
      calendarId: h.calendarId,
      provider,
    };
    const login = logins[h.username];
    sweepHosts.push({
      username: h.username,
      calendarId: h.calendarId,
      provider,
      session: login ? new TimewayHostSession(login, { baseUrl }) : undefined,
    });
  }
  const runner = new LoadRunner({
    store,
    timeway,
    hosts,
    runId: env.SOAK_RUN_ID ?? randomUUID().slice(0, 8),
    clock,
  });
  return { store, timeway, hosts, sweepHosts, graph, runner, baseUrl, env, clock };
}

/** Healthchecks ping (S8); the ping log doubles as the report's uptime source (S9). */
export async function ping(rt: Runtime, fetchFn: typeof fetch = fetch): Promise<PingLine> {
  const at = new Date(rt.clock.now()).toISOString();
  let line: PingLine = { at, ok: true, status: null };
  const url = rt.env.SOAK_HC_URL;
  if (url) {
    try {
      const res = await fetchFn(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
      line = { at, ok: true, status: res.status };
    } catch {
      // the runner itself is up; only the Healthchecks call failed
      line = { at, ok: true, status: 0 };
    }
  }
  rt.store.append("pings", line);
  return line;
}

/** A lag probe on a free slot of the host, used around drills. */
export function lagProber(rt: Runtime) {
  return async (host: SoakHost): Promise<LagLine[]> => {
    const now = rt.clock.now();
    const slots = await rt.timeway.getSlots(host.username, host.eventTypeSlug, {
      start: new Date(now + MIN_LEAD_MS).toISOString(),
      end: new Date(now + WINDOW_MS).toISOString(),
    });
    const free = Object.values(slots).flat();
    if (!free.length) return [];
    const slot = free[Math.floor(Math.random() * free.length)];
    return rt.runner.freeInjection(host, slot, "drill");
  };
}

export async function sweepDay(rt: Runtime, day: string) {
  const sweep = await runSweep({
    day,
    hosts: rt.sweepHosts,
    bookingLines: rt.store.read<BookingLine>("bookings"),
    busyLines: rt.store.read<BusyLine>("busy"),
    lagLines: rt.store.read<LagLine>("lag"),
    now: rt.clock.now,
  });
  rt.store.writeSweep(sweep);
  return sweep;
}

/** soak day index of `nowMs`, or null before SOAK_START_DAY / when unset */
export function soakDayIndex(startDay: string | undefined, nowMs: number): number | null {
  if (!startDay) return null;
  const idx = Math.floor((nowMs - Date.parse(`${startDay}T00:00:00Z`)) / DAY_MS);
  return idx >= 0 ? idx : null;
}

export function graphDrillDue(rt: Runtime): boolean {
  const idx = soakDayIndex(rt.env.SOAK_START_DAY, rt.clock.now());
  if (idx === null || idx < GRAPH_DRILL_DAY) return false;
  const start = Date.parse(`${rt.env.SOAK_START_DAY}T00:00:00Z`);
  return !rt.store
    .read<DrillLine>("drills")
    .some((d) => d.kind === "graphSubscriptionRemoved" && d.pass && Date.parse(d.at) >= start);
}

export async function graphDrill(rt: Runtime): Promise<DrillLine | null> {
  const host = Object.values(rt.hosts).find((h) => h.provider.name === "office365_calendar");
  if (!host || !rt.graph) return null;
  return runGraphSubscriptionRemoved({
    store: rt.store,
    host,
    graph: rt.graph,
    timewayBaseUrl: rt.baseUrl,
    clientState: required(rt.env, "MICROSOFT_WEBHOOK_TOKEN"),
    probe: lagProber(rt),
    clock: rt.clock,
  });
}

export async function drill410Verify(rt: Runtime): Promise<DrillLine> {
  const host =
    rt.hosts["soak-g1"] ?? Object.values(rt.hosts).find((h) => h.provider.name === "google_calendar");
  if (!host) throw new Error("no Google soak host configured");
  const metricsToken = rt.env.TIMEWAY_METRICS_TOKEN;
  return verifyGoogle410({
    store: rt.store,
    host,
    probe: lagProber(rt),
    clock: rt.clock,
    readCounter: metricsToken
      ? () => readTokenInvalidatedTotal({ baseUrl: rt.baseUrl, token: metricsToken })
      : undefined,
    baseline: rt.env.SOAK_410_BASELINE ? Number(rt.env.SOAK_410_BASELINE) : undefined,
  });
}

function every(ms: number, fn: () => Promise<unknown>, signal: AbortSignal, log: (e: unknown) => void) {
  const tick = () => {
    if (!signal.aborted) fn().catch(log);
  };
  tick();
  const t = setInterval(tick, ms);
  signal.addEventListener("abort", () => clearInterval(t));
}

/** The long-lived loop (S8): load scheduler + 5 min ping + 00:10 sweep + day-5 Graph drill. */
export async function runLoop(rt: Runtime, signal: AbortSignal): Promise<void> {
  const log = (e: unknown) => console.error(`[soak] ${e instanceof Error ? e.message : String(e)}`);
  every(PING_INTERVAL_MS, () => ping(rt), signal, log);
  let drillRunning = false;
  every(
    60_000,
    async () => {
      const now = rt.clock.now();
      const day = previousUtcDay(now);
      if (now % DAY_MS >= SWEEP_AFTER_MS && !rt.store.hasSweep(day)) {
        const s = await sweepDay(rt, day);
        console.log(`[soak] sweep ${day}: ${JSON.stringify(s.totals)}`);
      }
      if (!drillRunning && graphDrillDue(rt)) {
        drillRunning = true;
        try {
          const d = await graphDrill(rt);
          if (d) console.log(`[soak] graph drill ${d.pass ? "PASS" : "FAIL"}`);
        } finally {
          drillRunning = false;
        }
      }
    },
    signal,
    log
  );
  await runScheduler({
    hosts: Object.keys(rt.hosts),
    execute: async (plan) => {
      await rt.runner.execute(plan);
    },
    clock: rt.clock,
    signal,
    onError: (plan, e) =>
      log(`${plan.host} ${plan.injection}: ${e instanceof Error ? e.message : String(e)}`),
  });
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [cmd = "run", ...rest] = argv;
  if (cmd === "report") {
    const r = reportFromDir(env.SOAK_DIR ?? DEFAULT_SOAK_DIR);
    console.log(formatReport(r));
    return r.verdict.pass ? 0 : 1;
  }
  const rt = buildRuntime(env);
  if (cmd === "drill410") {
    if (!rest.includes("--verify")) {
      console.error(
        "drill410 only verifies; the syncToken write is the WC-TW-4d effect. Use: drill410 --verify"
      );
      return 2;
    }
    const d = await drill410Verify(rt);
    console.log(JSON.stringify({ kind: d.kind, pass: d.pass, finishedAt: d.finishedAt }));
    return d.pass ? 0 : 1;
  }
  if (cmd === "drill-graph") {
    const d = await graphDrill(rt);
    console.log(JSON.stringify(d ? { kind: d.kind, pass: d.pass } : { error: "no Graph host" }));
    return d?.pass ? 0 : 1;
  }
  if (cmd === "sweep") {
    const s = await sweepDay(rt, rest[0] ?? previousUtcDay(Date.now()));
    console.log(JSON.stringify(s.totals));
    return 0;
  }
  if (cmd !== "run") {
    console.error(`unknown command ${cmd}; use run | drill410 --verify | drill-graph | sweep [day] | report`);
    return 2;
  }
  const ac = new AbortController();
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => ac.abort());
  await runLoop(rt, ac.signal);
  return 0;
}

if (/[\\/]run\.(ts|mjs|js)$/.test(process.argv[1] ?? "")) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(`[soak] fatal: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  );
}
