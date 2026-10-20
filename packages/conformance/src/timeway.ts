import type { FetchLike, RetryOptions } from "./http.ts";
import { expectOk, fetchWithRetry, SoakHttpError } from "./http.ts";

export const TIMEWAY_PROD_URL = "https://timeway.co";

export type SlotRange = { start: string; end: string };

/** slot start ISO times grouped by date, as the booker's getSchedule returns them */
export type SlotsByDate = Record<string, string[]>;

export type BookingClassification = "accepted" | "rejected-conflict" | "rejected-other";

export type BookResult = {
  classification: BookingClassification;
  status: number;
  /** server error code / message for rejections */
  reason: string | null;
  bookingUid: string | null;
  bookingId: number | null;
  bookingStatus: string | null;
};

export type BookInput = {
  eventTypeId: number;
  eventTypeSlug?: string;
  start: string;
  end: string;
  name: string;
  email: string;
  timeZone?: string;
  language?: string;
  metadata?: Record<string, string>;
  /** uid returned by reserveSlot; binds the booker's own hold (WC-TW-3) */
  reservedSlotUid?: string;
};

/**
 * Server error codes that mean "the slot was not free" (HTTP 409 from defaultResponder). S5(a): these are the
 * system protecting the calendar, so they are correct outcomes, never errors.
 */
export const CONFLICT_ERROR_CODES: ReadonlySet<string> = new Set([
  "booking_conflict_error",
  "no_available_users_found_error",
  "fixed_hosts_unavailable_for_booking",
  "round_robin_host_unavailable_for_booking",
]);

export function classifyBookResponse(status: number, body: unknown): BookResult {
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (status >= 200 && status < 300) {
    return {
      classification: "accepted",
      status,
      reason: null,
      bookingUid: typeof obj.uid === "string" ? obj.uid : null,
      bookingId: typeof obj.id === "number" ? obj.id : null,
      bookingStatus: typeof obj.status === "string" ? obj.status : null,
    };
  }
  const reason = typeof obj.message === "string" ? obj.message : null;
  const isConflict = status === 409 && reason !== null && CONFLICT_ERROR_CODES.has(reason);
  return {
    classification: isConflict ? "rejected-conflict" : "rejected-other",
    status,
    reason,
    bookingUid: null,
    bookingId: null,
    bookingStatus: null,
  };
}

/** tRPC (superjson) query-string encoding used by the web booker for GET procedures. */
export function trpcInput(json: unknown): string {
  return encodeURIComponent(JSON.stringify({ json }));
}

type TrpcEnvelope<T> = { result?: { data?: { json?: T } }; error?: { json?: { message?: string } } };

export type TimewayClientOptions = RetryOptions & {
  baseUrl?: string;
  /** reported in User-Agent so soak traffic is identifiable in Timeway logs */
  userAgent?: string;
};

/**
 * Black-box booker client (S1): the same public HTTP paths the Timeway web booker calls. No DB, no credentials.
 */
export class TimewayClient {
  readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly userAgent: string;
  private readonly opts: TimewayClientOptions;

  constructor(opts: TimewayClientOptions = {}) {
    this.opts = opts;
    this.baseUrl = (opts.baseUrl ?? TIMEWAY_PROD_URL).replace(/\/$/, "");
    this.fetchFn = opts.fetch ?? (globalThis.fetch as FetchLike);
    this.userAgent = opts.userAgent ?? "timeway-soak/1 (+CC-64)";
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "user-agent": this.userAgent, accept: "application/json", ...extra };
  }

  /** GET /api/trpc/slots/getSchedule — the read the booker page makes. */
  async getSlots(
    username: string,
    eventTypeSlug: string,
    range: SlotRange,
    timeZone = "UTC"
  ): Promise<SlotsByDate> {
    const input = {
      usernameList: [username],
      eventTypeSlug,
      startTime: range.start,
      endTime: range.end,
      timeZone,
      isTeamEvent: false,
    };
    const res = await fetchWithRetry(
      `${this.baseUrl}/api/trpc/slots/getSchedule?input=${trpcInput(input)}`,
      { method: "GET", headers: this.headers() },
      "timeway getSlots",
      this.opts
    );
    const env = await expectOk<TrpcEnvelope<{ slots?: Record<string, { time: string }[]> }>>(
      res,
      "timeway getSlots"
    );
    const slots = env?.result?.data?.json?.slots ?? {};
    const out: SlotsByDate = {};
    for (const [date, list] of Object.entries(slots))
      out[date] = list.map((s) => new Date(s.time).toISOString());
    return out;
  }

  /** POST /api/trpc/slots/reserveSlot — the 5-minute hold taken when the booker opens the form. */
  async reserveSlot(input: { eventTypeId: number; start: string; end: string }): Promise<{ uid: string }> {
    const res = await fetchWithRetry(
      `${this.baseUrl}/api/trpc/slots/reserveSlot`,
      {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          json: { eventTypeId: input.eventTypeId, slotUtcStartDate: input.start, slotUtcEndDate: input.end },
        }),
      },
      "timeway reserveSlot",
      this.opts
    );
    const env = await expectOk<TrpcEnvelope<{ uid?: string }>>(res, "timeway reserveSlot");
    const uid = env?.result?.data?.json?.uid;
    if (!uid) {
      throw new SoakHttpError({
        kind: "client",
        status: res.status,
        body: "",
        attempts: 1,
        context: "timeway reserveSlot: no uid",
      });
    }
    return { uid };
  }

  /**
   * POST /api/book/event with the body the web booker sends. Not retried: a repeated POST could create a second
   * booking attempt, so a 429/5xx is recorded as rejected-other and the runner moves on.
   */
  async book(input: BookInput): Promise<BookResult> {
    const body = {
      start: input.start,
      end: input.end,
      eventTypeId: input.eventTypeId,
      ...(input.eventTypeSlug ? { eventTypeSlug: input.eventTypeSlug } : {}),
      responses: {
        name: input.name,
        email: input.email,
        location: { optionValue: "", value: "" },
        guests: [],
        notes: "",
      },
      timeZone: input.timeZone ?? "UTC",
      language: input.language ?? "en",
      metadata: input.metadata ?? {},
      hasHashedBookingLink: false,
      ...(input.reservedSlotUid ? { reservedSlotUid: input.reservedSlotUid } : {}),
    };
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/api/book/event`, {
        method: "POST",
        headers: this.headers({
          "content-type": "application/json",
          ...(input.reservedSlotUid ? { cookie: `uid=${input.reservedSlotUid}` } : {}),
        }),
        body: JSON.stringify(body),
      });
    } catch (error) {
      return {
        classification: "rejected-other",
        status: 0,
        reason: `network: ${error instanceof Error ? error.message : String(error)}`,
        bookingUid: null,
        bookingId: null,
        bookingStatus: null,
      };
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text.slice(0, 200) };
    }
    return classifyBookResponse(res.status, parsed);
  }

  /**
   * Cancel by uid through POST /api/cancel, which requires the double-submit CSRF pair from GET /api/csrf.
   * S10: the only way the soak removes bookings.
   */
  async cancel(
    bookingUid: string,
    opts: { cancelledBy?: string; reason?: string } = {}
  ): Promise<{ success: boolean; status: number }> {
    const csrfRes = await fetchWithRetry(
      `${this.baseUrl}/api/csrf`,
      { method: "GET", headers: this.headers() },
      "timeway csrf",
      this.opts
    );
    const { csrfToken } = await expectOk<{ csrfToken: string }>(csrfRes, "timeway csrf");
    const res = await fetchWithRetry(
      `${this.baseUrl}/api/cancel`,
      {
        method: "POST",
        headers: this.headers({
          "content-type": "application/json",
          cookie: `calcom.csrf_token=${csrfToken}`,
        }),
        body: JSON.stringify({
          uid: bookingUid,
          csrfToken,
          cancellationReason: opts.reason ?? "timeway soak cleanup",
          ...(opts.cancelledBy ? { cancelledBy: opts.cancelledBy } : {}),
        }),
      },
      "timeway cancel",
      this.opts
    );
    const result = await expectOk<{ success?: boolean }>(res, "timeway cancel");
    return { success: result?.success === true, status: res.status };
  }
}

/** True when `slotStart` is offered in the getSlots result. */
export function isSlotOffered(slots: SlotsByDate, slotStart: string): boolean {
  const target = new Date(slotStart).getTime();
  return Object.values(slots).some((list) => list.some((s) => new Date(s).getTime() === target));
}
