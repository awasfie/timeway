// @salesos/analytics — the browser client (the Bible's `@family/analytics`, WC-DX-3 step 2).
// Self-hosted PostHog through the app's own `/ingest` path: no third-party origin (checklist item 23).
// posthog-js is loaded lazily after init, so it never counts against the first-load JS budget.
// No key, no window, or Do-Not-Track => every call is a no-op and nothing throws.
import {
  ACTIVATION_EVENTS,
  CHECKLIST_STATES,
  EVENTS,
  LOCALES,
  PRODUCTS,
  type ActivationEventName,
  type ChecklistState,
  type Locale,
  type Product,
  type Props,
} from './events';
import { stripPii } from './pii';

export * from './events';
export { stripPii, PII_KEY } from './pii';

/** The subset of the posthog-js instance this package calls. */
export interface PostHogLike {
  init(key: string, config: Record<string, unknown>): unknown;
  identify(id: string, props?: Props): void;
  group(type: string, key: string, props?: Props): void;
  register(props: Props): void;
  capture(event: string, props?: Props): unknown;
  reset?(): void;
}

export interface InitOptions {
  key?: string | null;
  apiHost?: string;
  product: Product;
  /** Test seam; defaults to a dynamic import of posthog-js. */
  loader?: () => Promise<PostHogLike>;
}

export interface IdentifyTraits {
  orgId: string;
  locale: Locale;
  country?: string | null;
}

export interface WebVitalMetric {
  name: string;
  value: number;
  rating?: string;
  id?: string;
  /** web-vitals `attribution` (any shape; target/interaction fields are read when present). */
  attribution?: object;
}

/** posthog-js config: privacy defaults are fixed here, not per app. */
export function posthogConfig(apiHost: string): Record<string, unknown> {
  return {
    api_host: apiHost,
    autocapture: false,
    capture_pageview: 'history_change',
    capture_pageleave: true,
    disable_session_recording: true,
    disable_surveys: true,
    disable_external_dependency_loading: true,
    persistence: 'localStorage+cookie',
    cross_subdomain_cookie: false,
    respect_dnt: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    session_recording: { maskAllInputs: true },
    property_denylist: ['$email', 'email', 'phone', 'name'],
  };
}

type Call = (ph: PostHogLike) => void;

interface State {
  product: Product;
  locale?: Locale;
  country?: string | null;
  ph: PostHogLike | null;
  queue: Call[] | null; // non-null while posthog-js is loading
}

let state: State | null = null;

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function dntOn(): boolean {
  try {
    const n = typeof navigator !== 'undefined' ? (navigator as Navigator & { msDoNotTrack?: string }) : undefined;
    const w = typeof window !== 'undefined' ? (window as unknown as { doNotTrack?: string }) : undefined;
    const v = n?.doNotTrack ?? w?.doNotTrack ?? n?.msDoNotTrack;
    return v === '1' || v === 'yes';
  } catch {
    return false;
  }
}

function run(call: Call): void {
  try {
    if (!state) return;
    if (state.ph) call(state.ph);
    else if (state.queue) state.queue.push(call);
  } catch {
    /* analytics never breaks the app */
  }
}

const defaultLoader = async (): Promise<PostHogLike> =>
  (await import('posthog-js')).default as unknown as PostHogLike;

/** Returns true when the client will send events, false when it stays a no-op. */
export function init(opts: InitOptions): boolean {
  try {
    if (state) return true;
    if (!opts || !opts.key || !hasWindow() || dntOn()) return false;
    if (!(PRODUCTS as readonly string[]).includes(opts.product)) return false;
    const apiHost = opts.apiHost ?? '/ingest';
    const s: State = { product: opts.product, ph: null, queue: [] };
    state = s;
    const key = opts.key;
    void (opts.loader ?? defaultLoader)()
      .then((ph) => {
        if (state !== s) return;
        ph.init(key, posthogConfig(apiHost));
        ph.register({ product: s.product });
        const q = s.queue ?? [];
        s.ph = ph;
        s.queue = null;
        for (const c of q) {
          try {
            c(ph);
          } catch {
            /* drop */
          }
        }
      })
      .catch(() => {
        if (state === s) s.queue = null;
      });
    return true;
  } catch {
    return false;
  }
}

export function isEnabled(): boolean {
  return state !== null;
}

export function identify(userId: string, traits: IdentifyTraits): void {
  if (!state || !userId || !traits) return;
  const locale = (LOCALES as readonly string[]).includes(traits.locale) ? traits.locale : undefined;
  state.locale = locale;
  state.country = traits.country ?? null;
  const person = stripPii({ locale, country: state.country });
  const orgId = traits.orgId;
  run((ph) => {
    ph.identify(String(userId), person);
    if (orgId) ph.group('org', String(orgId), stripPii({ locale, country: person.country }));
    ph.register(stripPii({ locale, country: person.country }));
  });
}

function capture(event: string, props: Props): void {
  if (!state) return;
  const clean = stripPii(props);
  run((ph) => {
    ph.capture(event, clean);
  });
}

export function activation(eventName: ActivationEventName, props?: Props): void {
  if (!state) return;
  const allowed = ACTIVATION_EVENTS[state.product] as readonly string[];
  if (!allowed.includes(eventName)) return;
  capture(EVENTS.activation, {
    ...props,
    activation_event: eventName,
    product: state.product,
    locale: state.locale ?? null,
    country: state.country ?? null,
  });
}

export function checklistStep(stepId: string, stepState: ChecklistState, props?: Props): void {
  if (!state || !stepId) return;
  if (!(CHECKLIST_STATES as readonly string[]).includes(stepState)) return;
  capture(EVENTS.checklistStep, {
    ...props,
    step_id: stepId,
    state: stepState,
    product: state.product,
    locale: state.locale ?? null,
  });
}

export function webVital(metric: WebVitalMetric): void {
  if (!state || !metric) return;
  const a = (metric.attribution ?? {}) as Record<string, unknown>;
  let route: string | null = null;
  try {
    route = window.location.pathname;
  } catch {
    route = null;
  }
  capture(EVENTS.webVital, {
    metric: metric.name,
    value: metric.value,
    rating: metric.rating ?? null,
    id: metric.id ?? null,
    route,
    target: (a.interactionTarget ?? a.target ?? a.largestShiftTarget ?? null) as string | null,
    interaction_type: (a.interactionType ?? null) as string | null,
  });
}

/** Sign-out: forget the identity on this device. */
export function reset(): void {
  if (!state) return;
  state.locale = undefined;
  state.country = null;
  run((ph) => ph.reset?.());
}

/** Test-only: drop all client state. */
export function __resetForTests(): void {
  state = null;
}
