import type { z } from "zod";

import type { EventTypeMetaDataSchema } from "@calcom/prisma/zod-utils";

import { eventTypeMetaDataSchemaWithTypedApps } from "../../zod-utils";
import { getPaymentAppDataFromParsedMetadata } from "./getPaymentAppDataFromParsedMetadata";

export function getPaymentAppData(
  _eventType: {
    price: number;
    currency: string;
    metadata: z.infer<typeof EventTypeMetaDataSchema>;
  },
  forcedGet?: boolean
) {
  return getPaymentAppDataFromParsedMetadata(
    { ..._eventType, metadata: eventTypeMetaDataSchemaWithTypedApps.parse(_eventType.metadata) },
    forcedGet
  );
}

export type PaymentAppData = ReturnType<typeof getPaymentAppData>;
