const SMTPAPI_HEADER = "X-SMTPAPI";

/**
 * WC-TW-8c: tag outgoing SendGrid mail with `unique_args.bookingUid` so Event Webhook rows
 * correlate to the booking. Only touches mail that already carries the SendGrid X-SMTPAPI
 * header (i.e. EMAIL_SERVER_HOST is SendGrid); other transports are returned unchanged.
 */
export function withBookingUidSmtpApi(
  headers: Record<string, string> | undefined,
  bookingUid: string | undefined
): Record<string, string> | undefined {
  if (!headers || !bookingUid || !(SMTPAPI_HEADER in headers)) return headers;
  let smtpApi: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(headers[SMTPAPI_HEADER]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return headers;
    smtpApi = parsed as Record<string, unknown>;
  } catch {
    return headers;
  }
  const existing = smtpApi.unique_args && typeof smtpApi.unique_args === "object" ? smtpApi.unique_args : {};
  return {
    ...headers,
    [SMTPAPI_HEADER]: JSON.stringify({ ...smtpApi, unique_args: { ...existing, bookingUid } }),
  };
}
