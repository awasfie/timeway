// @salesos/analytics/server — API-side capture for activation facts created on the server.
// Plain fetch to `${host}/capture/`; no posthog-node. Never throws: returns false on any failure.
import { ACTIVATION_EVENTS, EVENTS, type ActivationEventName, type EventName, type Locale, type Product, type Props } from './events';
import { stripPii } from './pii';

export * from './events';
export { stripPii, PII_KEY } from './pii';

export interface ServerClientOptions {
  /** e.g. https://ph.awstreams.co (internal URL, not the browser `/ingest`). */
  host?: string | null;
  key?: string | null;
  product: Product;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ServerCaptureInput {
  event: EventName;
  distinctId: string;
  orgId?: string | null;
  properties?: Props;
}

export interface ServerActivationInput {
  distinctId: string;
  orgId: string;
  locale?: Locale | null;
  country?: string | null;
  properties?: Props;
}

export interface ServerClient {
  enabled: boolean;
  capture(input: ServerCaptureInput): Promise<boolean>;
  activation(eventName: ActivationEventName, input: ServerActivationInput): Promise<boolean>;
}

export function createServerClient(opts: ServerClientOptions): ServerClient {
  const host = (opts?.host ?? '').replace(/\/+$/, '');
  const key = opts?.key ?? '';
  const f = opts?.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  const enabled = Boolean(host && key && f && opts?.product);

  async function capture(input: ServerCaptureInput): Promise<boolean> {
    if (!enabled || !input?.distinctId || !input.event) return false;
    try {
      const properties: Props = { ...stripPii(input.properties), product: opts.product, $lib: '@salesos/analytics/server' };
      if (input.orgId) properties.$groups = { org: String(input.orgId) };
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
      const t = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 3000) : undefined;
      try {
        const res = await f!(`${host}/capture/`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            api_key: key,
            event: input.event,
            distinct_id: String(input.distinctId),
            properties,
            timestamp: new Date().toISOString(),
          }),
          signal: ctrl?.signal,
        });
        return res.ok;
      } finally {
        if (t) clearTimeout(t);
      }
    } catch {
      return false;
    }
  }

  async function activation(eventName: ActivationEventName, input: ServerActivationInput): Promise<boolean> {
    if (!enabled) return false;
    if (!(ACTIVATION_EVENTS[opts.product] as readonly string[]).includes(eventName)) return false;
    return capture({
      event: EVENTS.activation,
      distinctId: input.distinctId,
      orgId: input.orgId,
      properties: {
        ...input.properties,
        activation_event: eventName,
        locale: input.locale ?? null,
        country: input.country ?? null,
      },
    });
  }

  return { enabled, capture, activation };
}
