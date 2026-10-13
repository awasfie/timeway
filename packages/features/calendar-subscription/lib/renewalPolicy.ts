/**
 * WC-TW-2 (Bible v12.6 Q-5): renewal windows for push channels.
 * Google watch channels are renewed within 12 h of X-Goog-Channel-Expiration;
 * Microsoft Graph subscriptions are renewed when < 15 min remain.
 * The subscription cron runs every 10 min, so a channel inside its window is renewed on the next tick.
 */
export const RENEWAL_WINDOW_MS: Record<string, number> = {
  google_calendar: 12 * 60 * 60 * 1000,
  office365_calendar: 15 * 60 * 1000,
};

export const DEFAULT_RENEWAL_WINDOW_MS = 0;

export function renewalWindowMs(integration: string): number {
  return RENEWAL_WINDOW_MS[integration] ?? DEFAULT_RENEWAL_WINDOW_MS;
}

/** Instant at or before which a channel of this integration must be renewed. */
export function renewBefore(integration: string, now: Date = new Date()): Date {
  return new Date(now.getTime() + renewalWindowMs(integration));
}

export function needsRenewal(
  integration: string,
  channelExpiration: Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!channelExpiration) return true;
  return channelExpiration.getTime() <= renewBefore(integration, now).getTime();
}
