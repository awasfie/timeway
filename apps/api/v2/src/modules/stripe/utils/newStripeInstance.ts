import Stripe from "stripe";

import { gateStripe } from "./identityGate";

const stripeApiKey = process.env.STRIPE_API_KEY || "";
export const stripeInstance = gateStripe(
  new Stripe(stripeApiKey, {
    apiVersion: "2020-08-27",
  })
);
