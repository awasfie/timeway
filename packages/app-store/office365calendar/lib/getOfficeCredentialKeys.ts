import { getOfficeAppKeys } from "./getOfficeAppKeys";

type Keys = { client_id: string; client_secret: string };

/**
 * Soak-only per-credential client override (WC-TW-4 / t_d2a3e97e).
 * OFFICE365_CREDENTIAL_CLIENT_OVERRIDES = JSON {"<credentialId>": {"client_id": "...", "client_secret": "..."}}.
 * Only the listed credential ids use their own Entra app; every other credential keeps the App row keys.
 * Unset or malformed = no override (never throws, so production credentials are unaffected).
 */
export function parseCredentialOverrides(raw: string | undefined): Record<string, Keys> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<Keys>>;
    const out: Record<string, Keys> = {};
    for (const [id, v] of Object.entries(parsed)) {
      if (v && typeof v.client_id === "string" && typeof v.client_secret === "string") {
        out[id] = { client_id: v.client_id, client_secret: v.client_secret };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function getOfficeKeysForCredential(credentialId: number | undefined): Promise<Keys> {
  if (credentialId !== undefined) {
    const o = parseCredentialOverrides(process.env.OFFICE365_CREDENTIAL_CLIENT_OVERRIDES)[String(credentialId)];
    if (o) return o;
  }
  return getOfficeAppKeys();
}
