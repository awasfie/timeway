import { createHmac } from "node:crypto";
import { SECRET_PREFIX, signHeaders } from "@family/webhooks";

export const createWebhookSignature = (params: { secret?: string | null; body: string }) =>
  params.secret
    ? createHmac("sha256", params.secret).update(`${params.body}`).digest("hex")
    : "no-secret-provided";

/**
 * Signature headers for one delivery. X-Cal-Signature-256 is always sent so existing cal.com
 * subscribers see no change; a `whsec_` secret additionally gets the Standard Webhooks headers
 * (INT-2, WC-PE-14g D3) so a receiver can move to them without a dropped delivery.
 */
export const createWebhookHeaders = (params: {
  secret?: string | null;
  body: string;
}): Record<string, string> => {
  const headers: Record<string, string> = {
    "X-Cal-Signature-256": createWebhookSignature(params),
  };
  if (!params.secret || !params.secret.startsWith(SECRET_PREFIX)) return headers;
  try {
    Object.assign(headers, signHeaders(params.secret, params.body));
  } catch (error) {
    // A malformed whsec_ secret must not drop the delivery; the legacy header still goes out.
    console.warn(
      `webhook: Standard Webhooks signing skipped: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return headers;
};
