// Privacy floor: no email / phone / name ever leaves the app as an analytics property.
// Any key matching the pattern is dropped (case-insensitive, nested objects included).
import type { Props } from './events';

export const PII_KEY = /email|phone|name/i;

export function stripPii(props: Props | undefined): Props {
  const out: Props = {};
  if (!props || typeof props !== 'object') return out;
  for (const [k, v] of Object.entries(props)) {
    if (PII_KEY.test(k)) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? stripPii(v as Props) : v;
  }
  return out;
}
