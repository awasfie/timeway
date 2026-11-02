import { handleStripeWebhook } from "@calcom/app-store/stripepayment/lib/webhook";
import type { NextApiRequest, NextApiResponse } from "next";
import getRawBody from "raw-body";

export const config = {
  api: {
    bodyParser: false,
  },
};

// Stripe event payloads are far below this; the cap stops an unauthenticated caller from making us
// buffer an arbitrarily large body before the signature has been checked.
const STRIPE_WEBHOOK_BODY_LIMIT = "1mb";

function rawBodyErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const { status, type } = error as { status?: unknown; type?: unknown };
  if (type === "entity.too.large") return 413;
  if (typeof status === "number" && status >= 400 && status < 500) return status;
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }
  let rawBody: Buffer;
  try {
    rawBody = await getRawBody(req, {
      limit: STRIPE_WEBHOOK_BODY_LIMIT,
      length: req.headers["content-length"],
    });
  } catch (error) {
    const status = rawBodyErrorStatus(error);
    if (status === null) throw error;
    return res
      .status(status)
      .json({ received: false, outcome: status === 413 ? "body_too_large" : "bad_body" });
  }
  const signature = req.headers["stripe-signature"];
  const result = await handleStripeWebhook({
    rawBody,
    signature: Array.isArray(signature) ? signature[0] : signature,
  });
  return res.status(result.httpStatus).json({ received: result.httpStatus === 200, outcome: result.outcome });
}
