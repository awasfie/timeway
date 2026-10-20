import { expectOk, fetchWithRetry } from "../http.ts";
import type {
  BusyEventInput,
  CalendarProvider,
  OAuthClientConfig,
  ProviderEvent,
  ProviderOptions,
} from "./types.ts";
import { soakBusyTitle, TOKEN_SKEW_MS } from "./types.ts";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

type GoogleTokenResponse = { access_token: string; expires_in: number };

type GoogleEvent = {
  id: string;
  summary?: string;
  status?: string;
  transparency?: "opaque" | "transparent";
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

type GoogleEventList = { items?: GoogleEvent[]; nextPageToken?: string };

function toProviderEvent(e: GoogleEvent): ProviderEvent {
  return {
    id: e.id,
    title: e.summary ?? "",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    busy: e.transparency !== "transparent",
  };
}

/** Google Calendar v3 over plain fetch, authenticated with the harness's own refresh token (S1). */
export class GoogleCalendarClient implements CalendarProvider {
  readonly name = "google_calendar" as const;
  private accessToken: string | null = null;
  private expiresAt = 0;
  private readonly oauth: OAuthClientConfig;
  private readonly opts: ProviderOptions;

  constructor(oauth: OAuthClientConfig, opts: ProviderOptions = {}) {
    this.oauth = oauth;
    this.opts = opts;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.now() < this.expiresAt - TOKEN_SKEW_MS) return this.accessToken;
    const body = new URLSearchParams({
      client_id: this.oauth.clientId,
      client_secret: this.oauth.clientSecret,
      refresh_token: this.oauth.refreshToken,
      grant_type: "refresh_token",
    });
    const res = await fetchWithRetry(
      GOOGLE_TOKEN_URL,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      "google token refresh",
      this.opts
    );
    const token = await expectOk<GoogleTokenResponse>(res, "google token refresh");
    this.accessToken = token.access_token;
    this.expiresAt = this.now() + token.expires_in * 1000;
    return token.access_token;
  }

  private async call<T>(method: string, path: string, context: string, body?: unknown): Promise<T> {
    const token = await this.getAccessToken();
    const res = await fetchWithRetry(
      `${GOOGLE_CALENDAR_BASE}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
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
    // sendUpdates=none: the soak must never email anyone (S3).
    const created = await this.call<GoogleEvent>(
      "POST",
      `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
      "google insert busy event",
      {
        summary: soakBusyTitle(input.soakId),
        transparency: "opaque",
        start: { dateTime: input.start },
        end: { dateTime: input.end },
      }
    );
    return toProviderEvent(created);
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await this.call<null>(
      "DELETE",
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
      "google delete event"
    );
  }

  async listEvents(calendarId: string, window: { start: string; end: string }): Promise<ProviderEvent[]> {
    const events: ProviderEvent[] = [];
    let pageToken: string | undefined;
    do {
      const qs = new URLSearchParams({
        timeMin: window.start,
        timeMax: window.end,
        singleEvents: "true",
        showDeleted: "false",
        maxResults: "250",
      });
      if (pageToken) qs.set("pageToken", pageToken);
      const page = await this.call<GoogleEventList>(
        "GET",
        `/calendars/${encodeURIComponent(calendarId)}/events?${qs.toString()}`,
        "google list events"
      );
      for (const e of page.items ?? []) {
        if (e.status !== "cancelled") events.push(toProviderEvent(e));
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return events;
  }
}
