// Per-request phase timings for the booking page. Keyed on the request object so no module-level
// state crosses requests; values are durations only (no PII).
const timings = new WeakMap<object, Record<string, number>>();

export function recordTiming(key: object, name: string, ms: number) {
  const entry = timings.get(key) ?? {};
  entry[name] = Math.round(ms * 10) / 10;
  timings.set(key, entry);
}

export function measure<T>(key: object, name: string, promise: Promise<T>): Promise<T> {
  const start = performance.now();
  return promise.finally(() => recordTiming(key, name, performance.now() - start));
}

export function getTimings(key: object): Record<string, number> {
  return { ...(timings.get(key) ?? {}) };
}

const PHASES = ["session", "user", "event", "slots"] as const;

export function formatServerTiming(entries: Record<string, number>): string {
  return PHASES.filter((name) => entries[name] !== undefined)
    .map((name) => `${name};dur=${entries[name]}`)
    .join(", ");
}
