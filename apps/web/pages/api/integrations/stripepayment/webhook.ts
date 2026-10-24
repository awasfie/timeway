import { handleStripeWebhook } from "@calcom/app-store/stripepayment/lib/webhook";
import type { NextApiRequest, NextApiResponse } from "next";
import getRawBody from "raw-body";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }
  const rawBody = await getRawBody(req);
  const signature = req.headers["stripe-signature"];
  const result = await handleStripeWebhook({
    rawBody,
    signature: Array.isArray(signature) ? signature[0] : signature,
  });
  return res.status(result.httpStatus).json({ received: result.httpStatus === 200, outcome: result.outcome });
}
