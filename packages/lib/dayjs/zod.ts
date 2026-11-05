import { z } from "zod";

import { stringToDayjs } from "./index";

// Kept out of ./index so client code that only needs the date helpers does not ship zod (WC-TW-6n-4a).
export const stringToDayjsZod = z.string().transform(stringToDayjs);
