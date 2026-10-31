// Per-request phase timings for the booking page. Keyed on the request object so no module-level
// state crosses requests; values are durations only (no PII).
const timings = new WeakMap<object, Record<string, number>>();

/** Per-request store opened by serverTimingHeader.ts (node runtime); shared via globalThis so the
 * instrumentation bundle and the page bundle see the same AsyncLocalStorage instance. */
export const SERVER_TIMING_STORE = Symbol.for("timeway.serverTiming.store");
type ServerTimingStore = { getStore(): Record<string, number> | undefined };

const requestStore = () =>
  (globalThis as { [SERVER_TIMING_STORE]?: ServerTimingStore })[SERVER_TIMING_STORE]?.getStore();

export function recordTiming(key: object, name: string, ms: number) {
  const value = Math.round(ms * 10) / 10;
  const entry = timings.get(key) ?? {};
  entry[name] = value;
  timings.set(key, entry);
  const store = requestStore();
  if (store) store[name] = value;
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
