/**
 * In-process fixed-window limiter. The approval endpoint sits on the TLS handshake
 * path, so it must not wait on a remote limiter (Unkey's timeout is 5 s).
 */
export function createFixedWindowLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }) {
  const windows = new Map<string, { start: number; count: number }>();
  const maxKeys = opts.maxKeys ?? 10_000;

  return function allow(key: string, now: number = Date.now()): boolean {
    const w = windows.get(key);
    if (!w || now - w.start >= opts.windowMs) {
      if (!w && windows.size >= maxKeys) windows.clear();
      windows.set(key, { start: now, count: 1 });
      return true;
    }
    w.count++;
    return w.count <= opts.limit;
  };
}
