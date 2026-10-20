export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export type HttpErrorKind = "auth" | "not_found" | "gone" | "rate_limited" | "server" | "client" | "network";

/** Every provider/Timeway failure surfaces as this, so the runner can branch on `kind` without parsing text. */
export class SoakHttpError extends Error {
  readonly kind: HttpErrorKind;
  readonly status: number | null;
  readonly body: string;
  readonly attempts: number;

  constructor(opts: {
    kind: HttpErrorKind;
    status: number | null;
    body: string;
    attempts: number;
    context: string;
  }) {
    super(
      `${opts.context}: ${opts.kind}${opts.status ? ` (HTTP ${opts.status})` : ""} after ${opts.attempts} attempt(s)`
    );
    this.name = "SoakHttpError";
    this.kind = opts.kind;
    this.status = opts.status;
    this.body = opts.body;
    this.attempts = opts.attempts;
  }
}

export function kindForStatus(status: number): HttpErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 410) return "gone";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "client";
}

export const MAX_TRIES = 5;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Full jitter: uniform in [0, min(cap, base * 2^attempt)], honouring Retry-After when the server sends one. */
export function backoffDelayMs(
  attempt: number,
  retryAfterHeader: string | null,
  random: () => number = Math.random
): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_DELAY_MS);
  }
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

export type RetryOptions = {
  fetch?: FetchLike;
  sleep?: Sleep;
  random?: () => number;
  maxTries?: number;
};

/**
 * Sends the request, retrying 429/5xx and network failures with jittered backoff up to `maxTries` (<= 5).
 * Non-retryable statuses are returned to the caller as-is, so callers decide what a 409 or 410 means.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  context: string,
  opts: RetryOptions = {}
): Promise<Response> {
  const doFetch = opts.fetch ?? (globalThis.fetch as FetchLike);
  const sleep = opts.sleep ?? defaultSleep;
  const maxTries = Math.min(opts.maxTries ?? MAX_TRIES, MAX_TRIES);
  let lastStatus: number | null = null;
  let lastBody = "";
  let lastNetworkError: unknown = null;

  for (let attempt = 0; attempt < maxTries; attempt++) {
    let res: Response | null = null;
    try {
      res = await doFetch(url, init);
    } catch (error) {
      lastNetworkError = error;
    }
    if (res) {
      if (!isRetryableStatus(res.status)) return res;
      lastStatus = res.status;
      lastBody = await res.text().catch(() => "");
    }
    if (attempt < maxTries - 1) {
      await sleep(backoffDelayMs(attempt, res?.headers.get("retry-after") ?? null, opts.random));
    }
  }

  if (lastStatus === null) {
    throw new SoakHttpError({
      kind: "network",
      status: null,
      body: lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError),
      attempts: maxTries,
      context,
    });
  }
  throw new SoakHttpError({
    kind: kindForStatus(lastStatus),
    status: lastStatus,
    body: lastBody,
    attempts: maxTries,
    context,
  });
}

/** Throws a typed error for any non-2xx; returns parsed JSON (or null for an empty body). */
export async function expectOk<T>(res: Response, context: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    throw new SoakHttpError({
      kind: kindForStatus(res.status),
      status: res.status,
      body: text,
      attempts: 1,
      context,
    });
  }
  return (text ? JSON.parse(text) : null) as T;
}
