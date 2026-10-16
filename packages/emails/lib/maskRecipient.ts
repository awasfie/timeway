const EMAIL_PATTERN = /[^\s<>,;"']+@[^\s<>,;"']+/g;

function maskAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${address.slice(0, Math.min(2, at))}***@${address.slice(at + 1)}`;
}

/** Recipients appear in mail logs; only the first two chars of each local part survive. */
export function maskRecipient(to: string): string {
  const addresses = to.match(EMAIL_PATTERN);
  if (!addresses || addresses.length === 0) return to ? "***" : "";
  return addresses.map(maskAddress).join(",");
}

/** Recipient domains only (lower-cased, de-duplicated): the mail log never carries a local part. */
export function recipientDomains(to: string): string {
  const addresses = to.match(EMAIL_PATTERN);
  if (!addresses || addresses.length === 0) return "-";
  const domains = addresses
    .map((a) => a.slice(a.lastIndexOf("@") + 1).toLowerCase())
    .filter((d) => d.length > 0);
  return domains.length > 0 ? Array.from(new Set(domains)).join(",") : "-";
}
