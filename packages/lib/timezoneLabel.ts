// Booker-side timezone label without react-timezone-select/spacetime/timezone-soft, so the
// booking route can show the current zone before the picker chunk is loaded (WC-TW-6c-5).
// Legacy IANA links the old picker normalised through timezone-soft.
const LEGACY_ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "US/Eastern": "America/New_York",
  "US/Central": "America/Chicago",
  "US/Mountain": "America/Denver",
  "US/Pacific": "America/Los_Angeles",
  "Etc/UTC": "UTC",
};

export function canonicalTimezone(timeZone: string): string {
  return LEGACY_ALIASES[timeZone] ?? timeZone;
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function getTimezoneLabel(timeZone: string): string {
  const canonical = canonicalTimezone(timeZone);
  if (!isValidTimezone(canonical)) return timeZone.replace(/_/g, " ");
  return canonical.replace(/_/g, " ");
}
