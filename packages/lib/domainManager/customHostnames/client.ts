import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { z } from "zod";

/**
 * WC-TW-12 (D4, D6, D7): Cloudflare for SaaS custom hostnames on the timeway.co zone.
 * Separate from deploymentServices/cloudflare.ts, which manages org-subdomain DNS records.
 */

const CF_API = "https://api.cloudflare.com/client/v4";

// Cloudflare "Duplicate custom hostname found."
const CF_CODE_DUPLICATE_HOSTNAME = 1406;

const customHostnameSchema = z
  .object({
    id: z.string(),
    hostname: z.string(),
    status: z.string().default("pending"),
    created_at: z.string().nullish(),
    ssl: z
      .object({
        status: z.string().nullish(),
        validation_errors: z.array(z.object({ message: z.string() }).passthrough()).nullish(),
      })
      .passthrough()
      .nullish(),
    verification_errors: z.array(z.string()).nullish(),
    ownership_verification: z
      .object({ type: z.string(), name: z.string(), value: z.string() })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export type CfCustomHostname = z.infer<typeof customHostnameSchema>;

const envelope = <T extends z.ZodTypeAny>(result: T) =>
  z
    .object({
      success: z.boolean(),
      errors: z.array(z.object({ code: z.number(), message: z.string() }).passthrough()).default([]),
      result: result.nullish(),
      result_info: z
        .object({ page: z.number(), per_page: z.number(), total_pages: z.number().optional() })
        .passthrough()
        .nullish(),
    })
    .passthrough();

const singleEnvelope = envelope(customHostnameSchema);
const listEnvelope = envelope(z.array(customHostnameSchema));
const deleteEnvelope = envelope(z.object({ id: z.string() }).passthrough());

export class CustomHostnameApiError extends ErrorWithCode {
  readonly httpStatus: number;
  readonly cfCodes: number[];
  constructor(code: ErrorCode, message: string, httpStatus: number, cfCodes: number[]) {
    super(code, message, { httpStatus, cfCodes });
    this.name = "CustomHostnameApiError";
    this.httpStatus = httpStatus;
    this.cfCodes = cfCodes;
  }
}

/** Maps a Cloudflare failure to an ErrorWithCode. Credential failures never echo Cloudflare's text. */
export function mapCloudflareError(
  httpStatus: number,
  errors: { code: number; message: string }[]
): CustomHostnameApiError {
  const codes = errors.map((e) => e.code);
  if (httpStatus === 404) {
    return new CustomHostnameApiError(ErrorCode.NotFound, "Custom hostname not found", httpStatus, codes);
  }
  if (httpStatus === 409 || codes.includes(CF_CODE_DUPLICATE_HOSTNAME)) {
    return new CustomHostnameApiError(
      ErrorCode.BadRequest,
      "This subdomain is already connected to another account",
      httpStatus,
      codes
    );
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return new CustomHostnameApiError(
      ErrorCode.InternalServerError,
      "Custom domains are not configured",
      httpStatus,
      codes
    );
  }
  if (httpStatus === 400 || httpStatus === 422) {
    const detail = errors.map((e) => e.message).join("; ") || "rejected by Cloudflare";
    return new CustomHostnameApiError(ErrorCode.BadRequest, `Invalid subdomain: ${detail}`, httpStatus, codes);
  }
  return new CustomHostnameApiError(
    ErrorCode.InternalServerError,
    `Cloudflare is unavailable (HTTP ${httpStatus}); try again shortly`,
    httpStatus,
    codes
  );
}

export interface CustomHostnameClientOptions {
  apiToken: string;
  zoneId: string;
  fetchImpl?: typeof fetch;
}

export class CustomHostnameClient {
  private readonly base: string;
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor({ apiToken, zoneId, fetchImpl }: CustomHostnameClientOptions) {
    if (!apiToken || !zoneId) {
      throw new ErrorWithCode(ErrorCode.InternalServerError, "Custom domains are not configured");
    }
    this.base = `${CF_API}/zones/${encodeURIComponent(zoneId)}/custom_hostnames`;
    this.apiToken = apiToken;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  /** Reads CLOUDFLARE_SAAS_API_TOKEN and CLOUDFLARE_SAAS_ZONE_ID (D7). */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): CustomHostnameClient {
    return new CustomHostnameClient({
      apiToken: env.CLOUDFLARE_SAAS_API_TOKEN ?? "",
      zoneId: env.CLOUDFLARE_SAAS_ZONE_ID ?? "",
    });
  }

  private async call<T extends z.ZodTypeAny>(
    path: string,
    init: RequestInit,
    schema: T
  ): Promise<z.infer<T>> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.apiToken}`, "Content-Type": "application/json" },
      });
    } catch {
      throw mapCloudflareError(503, []);
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    const parsed = schema.safeParse(json);
    if (!res.ok || !parsed.success || parsed.data.success !== true) {
      const errors = parsed.success ? parsed.data.errors : [];
      throw mapCloudflareError(res.ok ? 502 : res.status, errors);
    }
    return parsed.data;
  }

  async create(hostname: string): Promise<CfCustomHostname> {
    const data = await this.call(
      "",
      {
        method: "POST",
        body: JSON.stringify({
          hostname,
          ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
        }),
      },
      singleEnvelope
    );
    if (!data.result) throw mapCloudflareError(502, []);
    return data.result;
  }

  async get(id: string): Promise<CfCustomHostname> {
    const data = await this.call(`/${encodeURIComponent(id)}`, { method: "GET" }, singleEnvelope);
    if (!data.result) throw mapCloudflareError(502, []);
    return data.result;
  }

  async delete(id: string): Promise<void> {
    await this.call(`/${encodeURIComponent(id)}`, { method: "DELETE" }, deleteEnvelope);
  }

  async list(): Promise<CfCustomHostname[]> {
    const all: CfCustomHostname[] = [];
    const perPage = 50;
    for (let page = 1; page <= 200; page++) {
      const data = await this.call(`?page=${page}&per_page=${perPage}`, { method: "GET" }, listEnvelope);
      const batch = data.result ?? [];
      all.push(...batch);
      const totalPages = data.result_info?.total_pages;
      if (totalPages !== undefined ? page >= totalPages : batch.length < perPage) break;
    }
    return all;
  }
}
