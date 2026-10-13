import process from "node:process";
import { getOffice365AccessToken } from "@calcom/app-store/office365calendar/lib/getOffice365AccessToken";
import dayjs from "@calcom/dayjs";
import { CalendarCacheEventService } from "@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventService";
import logger from "@calcom/lib/logger";
import type { SelectedCalendar } from "@calcom/prisma/client";
import type {
  CalendarCredential,
  CalendarSubscriptionEvent,
  CalendarSubscriptionEventItem,
  CalendarSubscriptionResult,
  ICalendarSubscriptionPort,
} from "../lib/CalendarSubscriptionPort.interface";

const log = logger.getSubLogger({ prefix: ["MicrosoftCalendarSubscriptionAdapter"] });

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type GraphClient = { accessToken: string };

interface MicrosoftGraphEvent {
  id: string;
  iCalUId?: string;
  subject?: string;
  bodyPreview?: string;
  location?: { displayName?: string };
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  showAs?: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";
  isAllDay?: boolean;
  isCancelled?: boolean;
  type?: string;
  seriesMasterId?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  "@removed"?: { reason?: string };
}

interface MicrosoftGraphEventsResponse {
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
  value: MicrosoftGraphEvent[];
}

interface MicrosoftGraphSubscriptionReq {
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
  clientState?: string;
  lifecycleNotificationUrl?: string;
}

interface MicrosoftGraphSubscriptionRes {
  id: string;
  resource: string;
  expirationDateTime: string;
}

type StoredDeltaState = { v: 1; windowEnd: string; deltaLink: string };

/** Re-run the window once the cache horizon has moved this far past the stored window end. */
const DELTA_WINDOW_STALE_MS = 7 * 24 * 60 * 60 * 1000;

type AdapterConfig = {
  baseUrl?: string;
  webhookToken?: string | null;
  webhookUrl?: string | null;
  subscriptionTtlMs?: number;
  getAccessToken?: (credential: CalendarCredential) => Promise<string>;
};

class GraphHttpError extends Error {
  constructor(
    readonly status: number,
    statusText: string
  ) {
    super(`Graph ${status} ${statusText}`);
  }
}

/** Graph returns wall-clock `dateTime` plus `timeZone`; with `Prefer: outlook.timezone="UTC"` that is UTC. */
function parseGraphDateTime(value?: { dateTime: string; timeZone: string }): Date | undefined {
  if (!value?.dateTime) return undefined;
  const hasOffset = /(Z|[+-]\d{2}:\d{2})$/.test(value.dateTime);
  const d = new Date(hasOffset ? value.dateTime : `${value.dateTime}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Office365 Calendar Subscription Adapter
 *
 * This adapter uses the Microsoft Graph API to create and manage calendar subscriptions
 * @see https://docs.microsoft.com/en-us/graph/api/resources/subscription
 */
export class Office365CalendarSubscriptionAdapter implements ICalendarSubscriptionPort {
  /** WC-TW-2: lifecycle notifications hit the same route with ?lifecycle=1. */
  static lifecycleUrl(webhookUrl: string): string {
    const u = new URL(webhookUrl);
    u.searchParams.set("lifecycle", "1");
    return u.toString();
  }

  private readonly baseUrl: string;
  private readonly webhookToken?: string | null;
  private readonly webhookUrl?: string | null;
  private readonly subscriptionTtlMs: number;
  private readonly getAccessToken: (credential: CalendarCredential) => Promise<string>;

  constructor(cfg: AdapterConfig = {}) {
    this.baseUrl = cfg.baseUrl ?? "https://graph.microsoft.com/v1.0";
    this.webhookToken = cfg.webhookToken ?? process.env.MICROSOFT_WEBHOOK_TOKEN ?? null;
    this.webhookUrl = cfg.webhookUrl ?? process.env.MICROSOFT_WEBHOOK_URL ?? null;
    this.subscriptionTtlMs = cfg.subscriptionTtlMs ?? 3 * 24 * 60 * 60 * 1000;
    this.getAccessToken = cfg.getAccessToken ?? getOffice365AccessToken;
  }

  async validate(request: Request): Promise<boolean> {
    // validate handshake
    let validationToken: string | null = null;
    if (request?.url) {
      try {
        const urlObj = new URL(request.url);
        validationToken = urlObj.searchParams.get("validationToken");
      } catch (e) {
        log.warn("Invalid request URL", { url: request.url });
      }
    }
    if (validationToken) return true;

    // validate notifications
    const clientState =
      request?.headers?.get("clientState") ??
      (typeof request?.body === "object" && request.body !== null && "clientState" in request.body
        ? (request.body as { clientState?: string }).clientState
        : undefined);
    if (!this.webhookToken) {
      log.warn("MICROSOFT_WEBHOOK_TOKEN missing");
      return false;
    }
    if (clientState !== this.webhookToken) {
      log.warn("Invalid clientState");
      return false;
    }
    return true;
  }

  async extractChannelId(request: Request): Promise<string | null> {
    let id: string | null = null;
    if (request?.body && typeof request.body === "object" && "subscriptionId" in request.body) {
      id = (request.body as { subscriptionId?: string }).subscriptionId ?? null;
    } else if (request?.headers?.get("subscriptionId")) {
      id = request.headers.get("subscriptionId");
    }
    if (!id) {
      log.warn("subscriptionId missing in webhook");
    }
    return id;
  }

  async subscribe(
    selectedCalendar: SelectedCalendar,
    credential: CalendarCredential
  ): Promise<CalendarSubscriptionResult> {
    if (!this.webhookUrl || !this.webhookToken) {
      throw new Error("Webhook config missing (MICROSOFT_WEBHOOK_URL/TOKEN)");
    }

    const expirationDateTime = new Date(Date.now() + this.subscriptionTtlMs).toISOString();

    const body: MicrosoftGraphSubscriptionReq = {
      resource: `me/calendars/${selectedCalendar.externalId}/events`,
      changeType: "created,updated,deleted",
      notificationUrl: this.webhookUrl,
      expirationDateTime,
      clientState: this.webhookToken,
      lifecycleNotificationUrl: Office365CalendarSubscriptionAdapter.lifecycleUrl(this.webhookUrl),
    };

    const client = await this.getGraphClient(credential);

    // WC-TW-2: renew an existing, unexpired subscription in place (PATCH expirationDateTime);
    // fall back to a fresh POST only when Graph no longer knows it (404).
    const existingId = selectedCalendar.channelId;
    const existingExp = selectedCalendar.channelExpiration;
    if (existingId && existingExp && new Date(existingExp).getTime() > Date.now()) {
      try {
        const renewed = await this.request<MicrosoftGraphSubscriptionRes>(
          client,
          "PATCH",
          `/subscriptions/${existingId}`,
          { expirationDateTime }
        );
        return {
          provider: "office365_calendar",
          id: renewed.id ?? existingId,
          resourceId: renewed.resource ?? selectedCalendar.channelResourceId,
          resourceUri: `${this.baseUrl}/${renewed.resource ?? selectedCalendar.channelResourceId}`,
          expiration: new Date(renewed.expirationDateTime ?? expirationDateTime),
        };
      } catch (err) {
        if (!(err instanceof GraphHttpError && err.status === 404)) throw err;
        log.warn("Graph subscription gone on renew; re-creating", { existingId });
      }
    }

    const res = await this.request<MicrosoftGraphSubscriptionRes>(client, "POST", "/subscriptions", body);

    return {
      provider: "office365_calendar",
      id: res.id,
      resourceId: res.resource,
      resourceUri: `${this.baseUrl}/${res.resource}`,
      expiration: new Date(res.expirationDateTime),
    };
  }

  async unsubscribe(selectedCalendar: SelectedCalendar, credential: CalendarCredential): Promise<void> {
    // Graph subscription id is stored in channelId (channelResourceId holds the resource path).
    const subId = selectedCalendar.channelId;
    if (!subId) return;

    const client = await this.getGraphClient(credential);
    await this.request(client, "DELETE", `/subscriptions/${subId}`);
  }

  async fetchEvents(
    selectedCalendar: SelectedCalendar,
    credential: CalendarCredential
  ): Promise<CalendarSubscriptionEvent> {
    const client = await this.getGraphClient(credential);
    const calendarId = selectedCalendar.externalId;
    const hadToken = !!selectedCalendar.syncToken;
    const stored = Office365CalendarSubscriptionAdapter.decodeSyncToken(selectedCalendar.syncToken);

    // The calendarView window is baked into the deltaLink, so a link reused for weeks stops covering
    // the far end of the cache window and those Outlook events would read as free. Legacy bare
    // deltaLinks carry no window end and are treated as stale.
    if (!stored || this.isWindowStale(stored.windowEnd)) {
      if (hadToken) {
        log.info("Graph delta window stale or unversioned; starting a new round", {
          externalId: calendarId,
          windowEnd: stored?.windowEnd.toISOString() ?? null,
        });
      }
      const full = await this.fullRound(client, calendarId);
      return hadToken ? { ...full, fullResync: true } : full;
    }

    try {
      return await this.deltaRound(
        client,
        this.stripBase(stored.deltaLink),
        stored.deltaLink,
        stored.windowEnd
      );
    } catch (err) {
      // Expired/invalid delta token: Graph answers 410 Gone; wipe and full-sync the window.
      if (err instanceof GraphHttpError && err.status === 410) {
        log.warn("Graph deltaLink invalidated (410); full resync", { externalId: calendarId });
        const full = await this.fullRound(client, calendarId);
        return { ...full, fullResync: true };
      }
      throw err;
    }
  }

  /** syncToken = JSON {v, windowEnd, deltaLink}; the adapter alone reads or writes it. */
  static encodeSyncToken(deltaLink: string, windowEnd: Date): string {
    const state: StoredDeltaState = { v: 1, windowEnd: windowEnd.toISOString(), deltaLink };
    return JSON.stringify(state);
  }

  static decodeSyncToken(raw: string | null | undefined): { deltaLink: string; windowEnd: Date } | null {
    if (!raw || !raw.startsWith("{")) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredDeltaState>;
      if (parsed.v !== 1 || typeof parsed.deltaLink !== "string" || typeof parsed.windowEnd !== "string") {
        return null;
      }
      const windowEnd = new Date(parsed.windowEnd);
      if (Number.isNaN(windowEnd.getTime())) return null;
      return { deltaLink: parsed.deltaLink, windowEnd };
    } catch {
      return null;
    }
  }

  private cacheWindow(): { start: Date; end: Date } {
    const start = dayjs().startOf("day");
    const end = start.add(CalendarCacheEventService.MONTHS_AHEAD, "month").endOf("day");
    return { start: start.toDate(), end: end.toDate() };
  }

  private isWindowStale(windowEnd: Date): boolean {
    return windowEnd.getTime() < this.cacheWindow().end.getTime() - DELTA_WINDOW_STALE_MS;
  }

  private async fullRound(client: GraphClient, calendarId: string): Promise<CalendarSubscriptionEvent> {
    const { start, end } = this.cacheWindow();
    const qs = new URLSearchParams({ startDateTime: start.toISOString(), endDateTime: end.toISOString() });
    const path = `/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta?${qs.toString()}`;
    return this.deltaRound(client, path, null, end);
  }

  /**
   * One delta round over the calendarView window. v1.0 only offers delta on calendarView
   * (`/calendars/{id}/events/delta` is beta), and the window is encoded in the returned links.
   */
  private async deltaRound(
    client: GraphClient,
    firstPath: string,
    previousDeltaLink: string | null,
    windowEnd: Date
  ): Promise<CalendarSubscriptionEvent> {
    let next: string | null = firstPath;
    let latestDeltaLink = previousDeltaLink;
    const items: MicrosoftGraphEvent[] = [];
    while (next) {
      const r: MicrosoftGraphEventsResponse = await this.request<MicrosoftGraphEventsResponse>(
        client,
        "GET",
        next
      );
      items.push(...(r.value ?? []));
      latestDeltaLink = r["@odata.deltaLink"] ?? latestDeltaLink;
      next = r["@odata.nextLink"] ? this.stripBase(r["@odata.nextLink"]) : null;
    }
    return {
      provider: "office365_calendar",
      syncToken: latestDeltaLink
        ? Office365CalendarSubscriptionAdapter.encodeSyncToken(latestDeltaLink, windowEnd)
        : null,
      items: this.parseEvents(items),
    };
  }

  private parseEvents(events: MicrosoftGraphEvent[]): CalendarSubscriptionEventItem[] {
    return events
      .filter((e) => !!e.id)
      .map((e) => {
        const removed = !!e["@removed"];
        // Same rule as Office365CalendarService.getAvailability, so cached and live busy times agree.
        const busy = !removed && e.showAs !== "free" && e.showAs !== "workingElsewhere";
        return {
          id: e.id,
          iCalUID: e.iCalUId ?? null,
          start: parseGraphDateTime(e.start),
          end: parseGraphDateTime(e.end),
          busy,
          etag: null,
          summary: e.subject ?? null,
          description: e.bodyPreview ?? null,
          location: e.location?.displayName ?? null,
          kind: e.type ?? "microsoftgraph#event",
          status: removed || e.isCancelled ? "cancelled" : "confirmed",
          isAllDay: e.isAllDay ?? false,
          timeZone: e.start?.timeZone ?? null,
          recurringEventId: e.seriesMasterId ?? null,
          originalStartDate: null,
          createdAt: e.createdDateTime ? new Date(e.createdDateTime) : null,
          updatedAt: e.lastModifiedDateTime ? new Date(e.lastModifiedDateTime) : null,
        };
      })
      .filter((item) => item.status === "cancelled" || (!!item.start && !!item.end));
  }

  private async getGraphClient(credential: CalendarCredential): Promise<GraphClient> {
    // credential.key is the stored OAuth token object, never a bearer string; refresh through OAuthManager.
    return { accessToken: await this.getAccessToken(credential) };
  }

  private stripBase(urlOrPath: string): string {
    return urlOrPath.startsWith("http") ? urlOrPath.replace(this.baseUrl, "") : urlOrPath;
  }

  private async request<T = unknown>(
    client: GraphClient,
    method: HttpMethod,
    endpoint: string,
    data?: unknown
  ): Promise<T> {
    const url = endpoint.startsWith("http") ? endpoint : `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${client.accessToken}`,
      "Content-Type": "application/json",
      Prefer: 'outlook.timezone="UTC"',
    };

    const init: RequestInit = { method, headers };
    if (data && (method === "POST" || method === "PUT" || method === "PATCH")) {
      init.body = JSON.stringify(data);
    }

    const res = await fetch(url, init);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.error("Graph API error", { method, endpoint: this.stripBase(url), status: res.status, text });
      throw new GraphHttpError(res.status, res.statusText);
    }

    if (method === "DELETE" || res.status === 204) return {} as T;

    return (await res.json()) as T;
  }
}
