import { randomUUID } from "node:crypto";
import type { TRPCError } from "@trpc/server";
import { z } from "zod";

type ErrorShape = {
  message: string;
  code: number;
  data: {
    code: string;
    httpStatus: number;
    path?: string;
    [key: string]: unknown;
  };
};

type ErrorFormatterOptions = {
  shape: ErrorShape;
  error: TRPCError;
  type: "query" | "mutation" | "subscription" | "unknown";
  path: string | undefined;
  input: unknown;
  ctx: unknown;
};

export function errorFormatter({ shape, error, ctx }: ErrorFormatterOptions): ErrorShape {
  if (error.cause instanceof z.ZodError) {
    return {
      message: "Invalid input",
      code: 400,
      data: {
        code: "BAD_REQUEST",
        httpStatus: 400,
        path: shape.data.path,
        zodError: error.cause.flatten(),
      },
    };
  }
  // WC-DX-14c2b (WC-DX-14 step 3): a 5xx carries a request id the UI shows (PageError) and the log records, so
  // support can match a user's report to the server error. Upstream x-request-id wins; otherwise mint one.
  if (shape.data.httpStatus >= 500) {
    const requestId = getRequestId(ctx);
    if (requestId) {
      console.error(`[trpc] ${shape.data.httpStatus} requestId=${requestId} path=${shape.data.path ?? "-"}`);
      return { ...shape, data: { ...shape.data, requestId } };
    }
  }
  return shape;
}

function getRequestId(ctx: unknown): string | undefined {
  const req = (ctx as { req?: { headers?: Record<string, string | string[] | undefined> } } | undefined)?.req;
  if (!req?.headers) return undefined;
  const header = req.headers["x-request-id"];
  const upstream = Array.isArray(header) ? header[0] : header;
  return upstream && /^[\w.:-]{1,128}$/.test(upstream) ? upstream : randomUUID();
}
