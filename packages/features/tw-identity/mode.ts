/**
 * TW-T14 — identity modes (PART TW; D-R44-2; CC-36).
 *
 *  - `local`    : NextAuth local accounts, self-contained; the dormant upstream Stripe
 *                 module may be used with Timeway's own key (self-hosted market).
 *  - `passport` : sign-in goes through a Passport session grant (ID.3 handoff); the org is
 *                 mirrored by `externalRef = passportOrgId`; Stripe is disabled by config and
 *                 NO Stripe call may leave the process (CC-36).
 *
 * Switch: env `TW_IDENTITY_MODE` = `passport` | `local` (default `local`). Any other
 * value is a boot error, never a silent fallback (a typo must not open Stripe in passport).
 */
export type TwIdentityMode = "passport" | "local";

export class TwIdentityModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwIdentityModeError";
  }
}

export function resolveIdentityMode(env: Record<string, string | undefined> = process.env): TwIdentityMode {
  const raw = (env.TW_IDENTITY_MODE ?? "").trim().toLowerCase();
  if (raw === "") return "local";
  if (raw === "passport" || raw === "local") return raw;
  throw new TwIdentityModeError(`TW_IDENTITY_MODE must be "passport" or "local", got "${raw}"`);
}

export const isPassportMode = (env: Record<string, string | undefined> = process.env) =>
  resolveIdentityMode(env) === "passport";

/** Boot-time check: passport mode needs Passport's coordinates and carries no Stripe variables. */
export function assertIdentityConfig(env: Record<string, string | undefined> = process.env): TwIdentityMode {
  const mode = resolveIdentityMode(env);
  if (mode === "passport") {
    const missing = ["PASSPORT_BASE_URL"].filter((k) => !env[k]);
    if (missing.length) throw new TwIdentityModeError(`passport mode requires ${missing.join(", ")}`);
    const stripeVars = Object.keys(env).filter((k) => /^STRIPE/i.test(k) && env[k]);
    if (stripeVars.length) {
      throw new TwIdentityModeError(
        `passport mode must carry no STRIPE* variables (found ${stripeVars.join(", ")})`
      );
    }
  }
  return mode;
}
