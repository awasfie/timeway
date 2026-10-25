import { loadTranslations } from "@calcom/i18n/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// The full common dictionary for a provider that started from the booker subset (WC-TW-6c-9c-2b).
// loadTranslations falls back to "en" for an unknown locale, so the path cannot read arbitrary files.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const translations = await loadTranslations(locale, "common");
  return NextResponse.json(translations, {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
