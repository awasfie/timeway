import type { RetryOptions } from "../http.ts";

export type ProviderEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  /** true for opaque/busy events; soak-busy events are always busy */
  busy: boolean;
};

export type BusyEventInput = {
  /** becomes the title `soak-busy-<id>` */
  soakId: string;
  start: string;
  end: string;
};

export interface CalendarProvider {
  readonly name: "google_calendar" | "office365_calendar";
  insertBusyEvent(calendarId: string, input: BusyEventInput): Promise<ProviderEvent>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
  listEvents(calendarId: string, window: { start: string; end: string }): Promise<ProviderEvent[]>;
}

export type OAuthClientConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export type ProviderOptions = RetryOptions & {
  /** clock used for access-token expiry; injectable for tests */
  now?: () => number;
};

export const SOAK_BUSY_PREFIX = "soak-busy-";

export function soakBusyTitle(soakId: string): string {
  return `${SOAK_BUSY_PREFIX}${soakId}`;
}

export function isSoakBusyTitle(title: string | null | undefined): boolean {
  return !!title && title.startsWith(SOAK_BUSY_PREFIX);
}

/** Refresh 60 s before expiry so a token never dies mid-request. */
export const TOKEN_SKEW_MS = 60_000;
