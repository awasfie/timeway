// WC-DX-3 step 2 (Q-11, WC.9.4): the frozen event vocabulary shared by every product.
// Adding a name is a code change reviewed on a PR; callers cannot invent event names.

export const PRODUCTS = Object.freeze(['spenai', 'timeway', 'camv', 'ligy', 'whatsaff', 'rsdeals', 'callya'] as const);
export type Product = (typeof PRODUCTS)[number];

export const LOCALES = Object.freeze(['ar', 'en'] as const);
export type Locale = (typeof LOCALES)[number];

/** PostHog event names this package emits. */
export const EVENTS = Object.freeze({
  activation: 'activation',
  checklistStep: 'checklist_step',
  webVital: 'web_vital',
  signupCompleted: 'signup_completed',
} as const);
export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** WC.9.3 activation facts, one per product (carried as `activation_event`). */
export const ACTIVATION_EVENTS = Object.freeze({
  spenai: ['first_lead_imported', 'first_sequence_step_sent'],
  timeway: ['first_booking_received'],
  camv: ['first_recording_shared'],
  ligy: ['first_link_clicked'],
  whatsaff: ['first_template_approved', 'first_message_sent'],
  rsdeals: ['first_unit_listed'],
  callya: ['first_test_call'],
} as const satisfies Record<Product, readonly string[]>);
export type ActivationEventName = (typeof ACTIVATION_EVENTS)[Product][number];

export const CHECKLIST_STATES = Object.freeze(['completed', 'dismissed', 'skipped'] as const);
export type ChecklistState = (typeof CHECKLIST_STATES)[number];

export type Props = Record<string, unknown>;
