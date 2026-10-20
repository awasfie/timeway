import { expectOk, fetchWithRetry } from "../http.ts";
import type {
  BusyEventInput,
  CalendarProvider,
  OAuthClientConfig,
  ProviderEvent,
  ProviderOptions,
} from "./types.ts";
import { soakBusyTitle, TOKEN_SKEW_MS } from "./types.ts";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
export const GRAPH_SCOPE = "offline_access https://graph.microsoft.com/Calendars.ReadWrite";

/** S2: the soak account is a consumer outlook.com account, so tokens come from the `consumers` authority. */
export function graphTokenUrl(tenant = "consumers"): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
}

type GraphTokenResponse = { access_token: string; expires_in: number; refresh_token?: string };

type GraphDateTime = { dateTime: string; timeZone: string };

type GraphEvent = {
  id: string;
  subject?: string;
  showAs?: string;
  isCancelled?: boolean;
  start?: GraphDateTime;
  end?: GraphDateTime;
};

type GraphList<T> = { value?: T[]; "@odata.nextLink"?: string };

export type GraphSubscription = {
  id: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  lifecycleNotificationUrl?: string | null;
  expirationDateTime: string;
};

/** Graph wants a zone-less local time plus a zone name; we always speak UTC. */
export function toGraphUtc(iso: string): GraphDateTime {
  return { dateTime: new Date(iso).toISOString().replace("Z", ""), timeZone: "UTC" };
}

/** Graph returns e.g. "2026-10-20T10:00:00.0000000" with timeZone "UTC" (we send Prefer outlook.timezone=UTC). */
export function fromGraphUtc(value: GraphDateTime | undefined): string {
  if (!value?.dateTime) return "";
  const trimmed = value.dateTime.replace(/(\.\d{3})\d*$/, "$1");
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(trimmed) ? trimmed : `${trimmed}Z`).toISOString();
}

function toProviderEvent(e: GraphEvent): ProviderEvent {
  return {
    id: e.id,
    title: e.subject ?? "",
    start: fromGraphUtc(e.start),
    end: fromGraphUtc(e.end),
    busy: e.showAs !== "free",
  };
}

export type GraphClientOptions = ProviderOptions & {
  tenant?: string;
  /** Microsoft may rotate refresh tokens; the runner persists the new one by name. */
  onRefreshTokenRotated?: (refreshToken: string) => void | Promise<void>;
};

/** Microsoft Graph v1.0 over plain fetch (S7: no @microsoft/microsoft-graph-client). */
export class GraphCalendarClient implements CalendarProvider {
  readonly name = "office365_calendar" as const;
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshToken: string;
  private readonly oauth: OAuthClientConfig;
  private readonly opts: GraphClientOptions;

  constructor(oauth: OAuthClientConfig, opts: GraphClientOptions = {}) {
    this.oauth = oauth;
    this.opts = opts;
    this.refreshToken = oauth.refreshToken;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.now() < this.expiresAt - TOKEN_SKEW_MS) return this.accessToken;
    const body = new URLSearchParams({
      client_id: this.oauth.clientId,
      client_secret: this.oauth.clientSecret,
      refresh_token: this.refreshToken,
      grant_type: "refresh_token",
      scope: GRAPH_SCOPE,
    });
    const res = await fetchWithRetry(
      graphTokenUrl(this.opts.tenant),
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      "graph token refresh",
      this.opts
    );
    const token = await expectOk<GraphTokenResponse>(res, "graph token refresh");
    this.accessToken = token.access_token;
    this.expiresAt = this.now() + token.expires_in * 1000;
    if (token.refresh_token && token.refresh_token !== this.refreshToken) {
      this.refreshToken = token.refresh_token;
      await this.opts.onRefreshTokenRotated?.(token.refresh_token);
    }
    return token.access_token;
  }

  private async call<T>(method: string, urlOrPath: string, context: string, body?: unknown): Promise<T> {
    const token = await this.getAccessToken();
    const url = urlOrPath.startsWith("https://") ? urlOrPath : `${GRAPH_BASE}${urlOrPath}`;
    const res = await fetchWithRetry(
      url,
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          prefer: 'outlook.timezone="UTC"',
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      context,
      this.opts
    );
    return expectOk<T>(res, context);
  }

  async insertBusyEvent(calendarId: string, input: BusyEventInput): Promise<ProviderEvent> {
    const created = await this.call<GraphEvent>(
      "POST",
      `/me/calendars/${encodeURIComponent(calendarId)}/events`,
      "graph insert busy event",
      {
        subject: soakBusyTitle(input.soakId),
        showAs: "busy",
        isReminderOn: false,
        responseRequested: false,
        start: toGraphUtc(input.start),
        end: toGraphUtc(input.end),
      }
    );
    return toProviderEvent(created);
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await this.call<null>(
      "DELETE",
      `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      "graph delete event"
    );
  }

  async listEvents(calendarId: string, window: { start: string; end: string }): Promise<ProviderEvent[]> {
    const qs = new URLSearchParams({
      startDateTime: window.start,
      endDateTime: window.end,
      $top: "250",
      $select: "id,subject,showAs,isCancelled,start,end",
    });
    let next: string | undefined =
      `/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${qs.toString()}`;
    const events: ProviderEvent[] = [];
    while (next) {
      const page: GraphList<GraphEvent> = await this.call<GraphList<GraphEvent>>(
        "GET",
        next,
        "graph list events"
      );
      for (const e of page.value ?? []) {
        if (!e.isCancelled) events.push(toProviderEvent(e));
      }
      next = page["@odata.nextLink"];
    }
    return events;
  }

  async listSubscriptions(): Promise<GraphSubscription[]> {
    const subs: GraphSubscription[] = [];
    let next: string | undefined = "/subscriptions";
    while (next) {
      const page: GraphList<GraphSubscription> = await this.call<GraphList<GraphSubscription>>(
        "GET",
        next,
        "graph list subscriptions"
      );
      subs.push(...(page.value ?? []));
      next = page["@odata.nextLink"];
    }
    return subs;
  }

  async deleteSubscription(subscriptionId: string): Promise<void> {
    await this.call<null>(
      "DELETE",
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      "graph delete subscription"
    );
  }
}

export type LifecycleNotificationInput = {
  timewayBaseUrl: string;
  subscriptionId: string;
  /** value of MICROSOFT_WEBHOOK_TOKEN, passed in by name from env; never logged */
  clientState: string;
  lifecycleEvent?: "subscriptionRemoved" | "reauthorizationRequired" | "missed";
  subscriptionExpirationDateTime?: string;
};

export function lifecycleNotificationUrl(timewayBaseUrl: string): string {
  const u = new URL("/api/webhooks/calendar-subscription/office365_calendar", timewayBaseUrl);
  u.searchParams.set("lifecycle", "1");
  return u.toString();
}

/**
 * S6 drill: after deleting the subscription at Graph, deliver the lifecycle notification Graph would have sent.
 * Timeway acks with 202 and re-subscribes in the background.
 */
export async function sendLifecycleNotification(
  input: LifecycleNotificationInput,
  opts: ProviderOptions = {}
): Promise<{ status: number }> {
  const res = await fetchWithRetry(
    lifecycleNotificationUrl(input.timewayBaseUrl),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        value: [
          {
            subscriptionId: input.subscriptionId,
            lifecycleEvent: input.lifecycleEvent ?? "subscriptionRemoved",
            clientState: input.clientState,
            subscriptionExpirationDateTime: input.subscriptionExpirationDateTime ?? new Date(0).toISOString(),
          },
        ],
      }),
    },
    "timeway graph lifecycle notification",
    opts
  );
  await expectOk<unknown>(res, "timeway graph lifecycle notification");
  return { status: res.status };
}
