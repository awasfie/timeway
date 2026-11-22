// TW-T14b: v2 cannot import @calcom/features, so this mirrors packages/features/tw-identity/stripeGate.ts.
// In TW_IDENTITY_MODE=passport no Stripe call may leave the process (CC-36).
export class StripeDisabledInPassportMode extends Error {
  constructor(what: string) {
    super(`Stripe is disabled in identity mode "passport" (${what}); CC-36 forbids any Stripe call`);
    this.name = "StripeDisabledInPassportMode";
  }
}

type Env = Record<string, string | undefined>;

export function isPassportMode(env: Env = process.env): boolean {
  const raw = (env.TW_IDENTITY_MODE ?? "").trim().toLowerCase();
  if (raw === "" || raw === "local") return false;
  if (raw === "passport") return true;
  throw new Error(`TW_IDENTITY_MODE must be "passport" or "local", got "${raw}"`);
}

export function gateStripe<T extends object>(client: T, env: () => Env = () => process.env): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (isPassportMode(env())) throw new StripeDisabledInPassportMode(String(prop));
      return Reflect.get(target, prop, receiver);
    },
  });
}

export function assertStripeAllowed(what: string, env: Env = process.env): void {
  if (isPassportMode(env)) throw new StripeDisabledInPassportMode(what);
}
