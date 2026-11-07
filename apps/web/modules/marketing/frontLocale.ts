import { PATHNAME_HEADER } from "@lib/i18n/pathnameHeader";
import { headers } from "next/headers";
import { frontLocaleFromPath } from "./frontPaths";
import type { FrontLocale } from "./i18n";

export async function getFrontLocale(): Promise<FrontLocale> {
  return frontLocaleFromPath((await headers()).get(PATHNAME_HEADER)) ?? "en";
}
