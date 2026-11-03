import { handleRum } from "@lib/telemetry/rum";

// WC-PE-12b3: field LCP beacon from every page (lib/telemetry/rum-client.tsx), observed into
// web_vitals_lcp_seconds{app="timeway"} and exported over OTLP.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleRum(req);
}
