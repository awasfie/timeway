import { resolveIdentityMode } from "./mode";

export class StripeDisabledInPassportMode extends Error {
  constructor(what: string) {
    super(`Stripe is disabled in identity mode "passport" (${what}); CC-36 forbids any Stripe call`);
    this.name = "StripeDisabledInPassportMode";
  }
}

type Env = Record<string, string | undefined>;

/**
 * Wrap a Stripe client so that in `passport` mode every property access throws before any
 * network call can be made. The mode is read on every access (env switch, no restart race).
 * In `local` mode the real client is returned untouched in behaviour.
 */
export function gateStripe<T extends object>(client: T, env: () => Env = () => process.env): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (resolveIdentityMode(env()) === "passport") {
        throw new StripeDisabledInPassportMode(String(prop));
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** Throw when a Stripe code path starts (webhooks, OAuth, payment service) in passport mode. */
export function assertStripeAllowed(what: string, env: Env = process.env): void {
  if (resolveIdentityMode(env) === "passport") throw new StripeDisabledInPassportMode(what);
}
