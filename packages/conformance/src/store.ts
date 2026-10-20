import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BookingClassification } from "./timeway.ts";

export const DEFAULT_SOAK_DIR = "/data/soak";

export const FILES = {
  bookings: "bookings.jsonl",
  lag: "lag.jsonl",
  drills: "drills.jsonl",
  busy: "busy.jsonl",
  pings: "pings.jsonl",
} as const;

export type InjectionPhase = "none" | "ahead" | "in-form";

/** One line per booking attempt (bookings.jsonl). */
export type BookingLine = {
  attemptId: string;
  host: string;
  provider: string;
  eventTypeId: number;
  start: string;
  end: string;
  attemptedAt: string;
  reservedAt: string | null;
  postSentAt: string;
  respondedAt: string;
  /** form-completion gap between reserveSlot and the POST */
  formGapMs: number;
  injection: {
    phase: InjectionPhase;
    busyId: string | null;
    providerEventId: string | null;
    createdAt: string | null;
  };
  classification: BookingClassification;
  status: number;
  reason: string | null;
  bookingUid: string | null;
  /** the Timeway-written provider event found for an accepted booking (null if not found within the settle) */
  providerEventId: string | null;
};

/** One line per busy-event lifecycle change (busy.jsonl); create and delete are separate lines. */
export type BusyLine = {
  op: "create" | "delete";
  busyId: string;
  host: string;
  providerEventId: string;
  start: string;
  end: string;
  at: string;
  purpose: InjectionPhase | "free" | "drill";
};

/** lag.jsonl; t1 null = slot never flipped within the 900 s cap. */
export type LagLine = {
  busyId: string;
  host: string;
  kind: "insert" | "delete";
  slotStart: string;
  t0: string;
  t1: string | null;
  polls: number;
};

export type DrillLine = {
  kind: "google410" | "graphSubscriptionRemoved";
  at: string;
  finishedAt: string;
  host: string;
  pass: boolean;
  details: Record<string, unknown>;
};

export type PingLine = { at: string; ok: boolean; status: number | null };

export type SweepFile = {
  day: string;
  sweptAt: string;
  /** "timeway-list" = tRPC viewer.bookings.get as each soak host; "runner-log" = bookings.jsonl only */
  bookingSource: "timeway-list" | "runner-log";
  totals: {
    attempts: number;
    accepted: number;
    conflicts: number;
    errors: number;
    doubleBookings: number;
    orphans: number;
    lagSamples: number;
    lagTimeouts: number;
    lagP50: number | null;
    lagP95: number | null;
  };
  hosts: Record<
    string,
    { attempts: number; accepted: number; doubleBookings: number; orphans: number; bookingSource: string }
  >;
  doubleBookings: unknown[];
  orphans: unknown[];
  errors: string[];
};

export class SoakStore {
  readonly dir: string;

  constructor(dir: string = DEFAULT_SOAK_DIR) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  /** Append-only by construction: the store has no rewrite or delete for JSONL files. */
  append(file: keyof typeof FILES, record: unknown): void {
    appendFileSync(join(this.dir, FILES[file]), `${JSON.stringify(record)}\n`);
  }

  read<T>(file: keyof typeof FILES): T[] {
    return readJsonl<T>(join(this.dir, FILES[file]));
  }

  sweepPath(day: string): string {
    return join(this.dir, `sweep-${day}.json`);
  }

  hasSweep(day: string): boolean {
    return existsSync(this.sweepPath(day));
  }

  writeSweep(sweep: SweepFile): void {
    writeFileSync(this.sweepPath(sweep.day), `${JSON.stringify(sweep, null, 2)}\n`);
  }

  readSweeps(): SweepFile[] {
    return readdirSync(this.dir)
      .filter((f) => /^sweep-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf8")) as SweepFile);
  }
}

/** Skips a torn last line (the runner may die mid-write) instead of failing the whole report. */
export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // torn line
    }
  }
  return out;
}
