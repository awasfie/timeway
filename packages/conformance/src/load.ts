import { randomUUID } from "node:crypto";
import type { Sleep } from "./http.ts";
import type { CalendarProvider } from "./providers/types.ts";
import { isSoakBusyTitle } from "./providers/types.ts";
import type { BookingLine, BusyLine, InjectionPhase, LagLine, SoakStore } from "./store.ts";
import type { SlotsByDate, TimewayClient } from "./timeway.ts";
import { isSlotOffered } from "./timeway.ts";

export type SoakHost = {
  /** Timeway username, e.g. soak-g1 */
  username: string;
  eventTypeId: number;
  eventTypeSlug: string;
  /** provider calendar id the host writes to and checks conflicts against */
  calendarId: string;
  provider: CalendarProvider;
};

export const DAY_MS = 24 * 60 * 60 * 1000;
export const SLOT_MS = 30 * 60 * 1000;
export const WINDOW_MS = 7 * DAY_MS;
/** 56 > the S4 floor of 50 so a few failed starts (restart, provider 5xx) never drop a day below 200. */
export const ATTEMPTS_PER_HOST_PER_DAY = 56;
export const INJECTION_SHARE = 0.3;
/** of the injections; S4 asks >= 1/3, 0.4 keeps margin after rounding */
export const IN_FORM_SHARE = 0.4;
export const MAX_FORM_GAP_MS = 90_000;
export const LAG_POLL_MS = 5_000;
export const LAG_CAP_MS = 900_000;
/** how long after an accepted POST the runner looks for the Timeway-written provider event */
export const PROVIDER_EVENT_WAIT_MS = 120_000;
/** never book a slot starting sooner than this, so the attempt cannot race the slot into the past */
export const MIN_LEAD_MS = 60 * 60 * 1000;

export type Random = () => number;

export type AttemptPlan = {
  host: string;
  /** epoch ms the attempt starts */
  at: number;
  /** none = plain booking; ahead = busy on the target before the attempt; in-form = between reserve and POST;
   *  free = busy on a different free slot, probed for lag only */
  injection: InjectionPhase | "free";
};

function shuffle<T>(items: T[], random: Random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * One host's attempts for one UTC day: the day is cut into equal strata and each attempt lands at a uniform random
 * point in its own stratum (S4 jitter without bursts). Injection phases are assigned by exact counts, so the
 * 30 % / >= 1/3 in-form split holds every day rather than only on average.
 */
export function planHostDay(
  host: string,
  dayStartMs: number,
  random: Random,
  count: number = ATTEMPTS_PER_HOST_PER_DAY
): AttemptPlan[] {
  const stratum = DAY_MS / count;
  const injected = Math.round(count * INJECTION_SHARE);
  const inForm = Math.ceil(injected * IN_FORM_SHARE);
  const rest = injected - inForm;
  const ahead = Math.ceil(rest / 2);
  const phases: AttemptPlan["injection"][] = [
    ...Array<AttemptPlan["injection"]>(inForm).fill("in-form"),
    ...Array<AttemptPlan["injection"]>(ahead).fill("ahead"),
    ...Array<AttemptPlan["injection"]>(rest - ahead).fill("free"),
    ...Array<AttemptPlan["injection"]>(count - injected).fill("none"),
  ];
  const assigned = shuffle(phases, random);
  return assigned.map((injection, i) => ({
    host,
    at: Math.floor(dayStartMs + i * stratum + random() * stratum),
    injection,
  }));
}

export const utcDayStart = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;

export type Clock = { now: () => number; sleep: Sleep };

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Runs `execute` for every planned attempt of every host, day after day, until `signal` aborts. Attempts are fired
 * without awaiting, so a slow attempt (lag probe up to 15 min) never delays the next one. Plans whose time already
 * passed when the scheduler starts mid-day are skipped, not burst.
 */
export async function runScheduler(opts: {
  hosts: string[];
  execute: (plan: AttemptPlan) => Promise<void>;
  clock?: Clock;
  random?: Random;
  signal?: AbortSignal;
  onError?: (plan: AttemptPlan, error: unknown) => void;
}): Promise<void> {
  const clock = opts.clock ?? realClock;
  const random = opts.random ?? Math.random;
  while (!opts.signal?.aborted) {
    const dayStart = utcDayStart(clock.now());
    const plans = opts.hosts
      .flatMap((h) => planHostDay(h, dayStart, random))
      .filter((p) => p.at >= clock.now())
      .sort((a, b) => a.at - b.at);
    for (const plan of plans) {
      const wait = plan.at - clock.now();
      if (wait > 0) await clock.sleep(wait);
      if (opts.signal?.aborted) return;
      opts.execute(plan).catch((error) => opts.onError?.(plan, error));
    }
    const nextDay = dayStart + DAY_MS;
    const wait = nextDay - clock.now();
    if (wait > 0) await clock.sleep(wait);
  }
}

/** Polls `offered()` every 5 s until it equals `want`; t1 = null after the 900 s cap (S5c). */
export async function pollUntilFlip(opts: {
  offered: () => Promise<boolean>;
  want: boolean;
  clock: Clock;
  intervalMs?: number;
  capMs?: number;
}): Promise<{ t1: number | null; polls: number }> {
  const interval = opts.intervalMs ?? LAG_POLL_MS;
  const cap = opts.capMs ?? LAG_CAP_MS;
  const started = opts.clock.now();
  let polls = 0;
  while (opts.clock.now() - started <= cap) {
    polls++;
    try {
      if ((await opts.offered()) === opts.want) return { t1: opts.clock.now(), polls };
    } catch {
      // a failed poll is not a flip; keep polling until the cap
    }
    await opts.clock.sleep(interval);
  }
  return { t1: null, polls };
}

const iso = (ms: number) => new Date(ms).toISOString();

export type LoadDeps = {
  store: SoakStore;
  timeway: TimewayClient;
  hosts: Record<string, SoakHost>;
  runId: string;
  clock?: Clock;
  random?: Random;
};

export function allOfferedSlots(slots: SlotsByDate): string[] {
  return Object.values(slots).flat();
}

/** Executes plans against prod and writes bookings.jsonl / busy.jsonl / lag.jsonl. */
export class LoadRunner {
  private readonly d: Required<LoadDeps>;

  constructor(deps: LoadDeps) {
    this.d = { clock: realClock, random: Math.random, ...deps };
  }

  private now(): number {
    return this.d.clock.now();
  }

  private async offered(host: SoakHost, slotStart: string, bookerUid?: string): Promise<boolean> {
    const s = new Date(slotStart).getTime();
    const slots = await this.d.timeway.getSlots(
      host.username,
      host.eventTypeSlug,
      { start: iso(s - SLOT_MS), end: iso(s + 2 * SLOT_MS) },
      "UTC",
      bookerUid
    );
    return isSlotOffered(slots, slotStart);
  }

  private async freeSlots(host: SoakHost): Promise<string[]> {
    const from = this.now() + MIN_LEAD_MS;
    const slots = await this.d.timeway.getSlots(host.username, host.eventTypeSlug, {
      start: iso(from),
      end: iso(this.now() + WINDOW_MS),
    });
    return allOfferedSlots(slots).filter((s) => new Date(s).getTime() >= from);
  }

  private pick<T>(items: T[]): T {
    return items[Math.floor(this.d.random() * items.length)];
  }

  async insertBusy(host: SoakHost, slotStart: string, purpose: BusyLine["purpose"]): Promise<BusyLine> {
    const busyId = randomUUID().slice(0, 12);
    const end = iso(new Date(slotStart).getTime() + SLOT_MS);
    const ev = await host.provider.insertBusyEvent(host.calendarId, {
      soakId: busyId,
      start: slotStart,
      end,
    });
    const line: BusyLine = {
      op: "create",
      busyId,
      host: host.username,
      providerEventId: ev.id,
      start: slotStart,
      end,
      at: iso(this.now()),
      purpose,
    };
    this.d.store.append("busy", line);
    return line;
  }

  async deleteBusy(host: SoakHost, created: BusyLine): Promise<BusyLine> {
    await host.provider.deleteEvent(host.calendarId, created.providerEventId);
    const line: BusyLine = { ...created, op: "delete", at: iso(this.now()) };
    this.d.store.append("busy", line);
    return line;
  }

  /** One lag sample (S5c) appended to lag.jsonl. `confounded` marks samples a booking, not the busy event, flipped. */
  async probe(
    host: SoakHost,
    busy: BusyLine,
    kind: "insert" | "delete",
    bookerUid?: string
  ): Promise<LagLine> {
    const { t1, polls } = await pollUntilFlip({
      offered: () => this.offered(host, busy.start, bookerUid),
      want: kind === "delete",
      clock: this.d.clock,
    });
    const line: LagLine = {
      busyId: busy.busyId,
      host: host.username,
      kind,
      slotStart: busy.start,
      t0: busy.at,
      t1: t1 === null ? null : iso(t1),
      polls,
    };
    this.d.store.append("lag", line);
    return line;
  }

  /** insert -> probe -> delete -> probe on a slot nobody books */
  async freeInjection(
    host: SoakHost,
    slotStart: string,
    purpose: BusyLine["purpose"] = "free"
  ): Promise<LagLine[]> {
    const busy = await this.insertBusy(host, slotStart, purpose);
    const ins = await this.probe(host, busy, "insert");
    const del = await this.deleteBusy(host, busy);
    return [ins, await this.probe(host, del, "delete")];
  }

  private async findProviderEvent(host: SoakHost, start: string, end: string): Promise<string | null> {
    const deadline = this.now() + PROVIDER_EVENT_WAIT_MS;
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    while (this.now() <= deadline) {
      try {
        const events = await host.provider.listEvents(host.calendarId, { start, end });
        const hit = events.find(
          (ev) =>
            !isSoakBusyTitle(ev.title) &&
            new Date(ev.start).getTime() === s &&
            new Date(ev.end).getTime() === e
        );
        if (hit) return hit.id;
      } catch {
        // retried until the deadline; the daily sweep is authoritative anyway
      }
      await this.d.clock.sleep(15_000);
    }
    return null;
  }

  async execute(plan: AttemptPlan): Promise<BookingLine | null> {
    const host = this.d.hosts[plan.host];
    const attemptId = randomUUID();
    const attemptedAt = iso(this.now());
    const free = await this.freeSlots(host);
    if (!free.length) {
      const line = this.emptyLine(host, attemptId, attemptedAt, "no-free-slot");
      this.d.store.append("bookings", line);
      return line;
    }
    const slot = this.pick(free);
    const end = iso(new Date(slot).getTime() + SLOT_MS);

    if (plan.injection === "free") {
      const others = free.filter((s) => s !== slot);
      // fire-and-forget: its lag probes run alongside the plain booking below
      if (others.length) void this.freeInjection(host, this.pick(others)).catch(() => {});
    }

    // Our own hold must not look like a flip to the lag probe, so every probe of this slot carries the booker uid.
    const bookerUid = randomUUID();
    let busy: BusyLine | null = null;
    let insertProbe: Promise<LagLine> | null = null;
    if (plan.injection === "ahead") {
      busy = await this.insertBusy(host, slot, "ahead");
      insertProbe = this.probe(host, busy, "insert", bookerUid);
    }

    const reserved = await this.d.timeway.reserveSlot({
      eventTypeId: host.eventTypeId,
      start: slot,
      end,
      bookerUid,
    });
    const reservedAt = this.now();
    const formGapMs = Math.floor(this.d.random() * MAX_FORM_GAP_MS);

    if (plan.injection === "in-form") {
      const injectAfter = Math.floor(this.d.random() * formGapMs);
      await this.d.clock.sleep(injectAfter);
      busy = await this.insertBusy(host, slot, "in-form");
      insertProbe = this.probe(host, busy, "insert", bookerUid);
      await this.d.clock.sleep(Math.max(0, formGapMs - injectAfter));
    } else {
      await this.d.clock.sleep(formGapMs);
    }

    const postSentAt = iso(this.now());
    const result = await this.d.timeway.book({
      eventTypeId: host.eventTypeId,
      eventTypeSlug: host.eventTypeSlug,
      start: slot,
      end,
      name: `Soak ${host.username}`,
      email: `soak+${this.d.runId}@awstreams.com`,
      reservedSlotUid: reserved.uid,
      metadata: { soakAttemptId: attemptId, soakRunId: this.d.runId },
    });
    const respondedAt = iso(this.now());
    const providerEventId =
      result.classification === "accepted" ? await this.findProviderEvent(host, slot, end) : null;

    const line: BookingLine = {
      attemptId,
      host: host.username,
      provider: host.provider.name,
      eventTypeId: host.eventTypeId,
      start: slot,
      end,
      attemptedAt,
      reservedAt: iso(reservedAt),
      postSentAt,
      respondedAt,
      formGapMs,
      injection: {
        phase: plan.injection === "free" ? "none" : plan.injection,
        busyId: busy?.busyId ?? null,
        providerEventId: busy?.providerEventId ?? null,
        createdAt: busy?.at ?? null,
      },
      classification: result.classification,
      status: result.status,
      reason: result.reason,
      bookingUid: result.bookingUid,
      providerEventId,
    };
    this.d.store.append("bookings", line);

    if (busy && insertProbe) {
      await insertProbe;
      const del = await this.deleteBusy(host, busy);
      // after an accepted booking the slot never reappears, so a delete sample would only measure the cap
      if (result.classification !== "accepted") await this.probe(host, del, "delete", bookerUid);
    }
    return line;
  }

  private emptyLine(host: SoakHost, attemptId: string, at: string, reason: string): BookingLine {
    return {
      attemptId,
      host: host.username,
      provider: host.provider.name,
      eventTypeId: host.eventTypeId,
      start: at,
      end: at,
      attemptedAt: at,
      reservedAt: null,
      postSentAt: at,
      respondedAt: at,
      formGapMs: 0,
      injection: { phase: "none", busyId: null, providerEventId: null, createdAt: null },
      classification: "rejected-other",
      status: 0,
      reason,
      bookingUid: null,
      providerEventId: null,
    };
  }
}
