import { Prisma } from "../client";
import { getTwOrgContext, type TwOrgContext } from "../tw-org-context";

/**
 * TW-T9.2a — applies the request's org scope (tw-org-context.ts ALS) to every query.
 *
 * `set_config(..., true)` only lives for one transaction, so a top-level operation
 * runs as the batch `$transaction([set_config, op])`; inside an interactive or batch
 * transaction the `$transaction` wrapper below has already set it on that connection.
 * With no scope nothing is set and the query runs as before, which is what keeps this
 * card behaviour-neutral until RLS lands (TW-T9.2d) and fail-closed after it.
 */

type RawExecutor = {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Prisma.PrismaPromise<number>;
};

type TransactionalClient = RawExecutor & {
  $transaction(arg: unknown, options?: unknown): Promise<unknown>;
};

function contextStatement(client: RawExecutor, ctx: TwOrgContext): Prisma.PrismaPromise<number> {
  return ctx.kind === "org"
    ? client.$executeRaw`select set_config('app.tw_org_id', ${ctx.orgId}, true)`
    : client.$executeRaw`select set_config('app.tw_platform', 'on', true)`;
}

function inTransaction(params: unknown): boolean {
  const internal = (params as { __internalParams?: { transaction?: unknown } }).__internalParams;
  return Boolean(internal?.transaction);
}

export function twOrgContextExtension() {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: "tw-org-context",
      query: {
        async $allOperations(params) {
          const ctx = getTwOrgContext();
          if (!ctx || inTransaction(params)) return params.query(params.args);
          const [, result] = await client.$transaction([
            contextStatement(client as unknown as RawExecutor, ctx),
            params.query(params.args) as Prisma.PrismaPromise<unknown>,
          ]);
          return result;
        },
      },
    })
  );
}

/**
 * Sets the scope first inside `$transaction`, interactive or batch. Prisma has no hook
 * for transaction start, so the client is wrapped; everything else passes through.
 */
export function withTwOrgTransactions<C extends object>(client: C): C {
  const target = client as unknown as TransactionalClient;
  return new Proxy(client, {
    get(obj, prop, receiver) {
      if (prop !== "$transaction") return Reflect.get(obj, prop, receiver);
      return (arg: unknown, options?: unknown) => {
        const ctx = getTwOrgContext();
        if (!ctx) return target.$transaction(arg, options);
        if (Array.isArray(arg)) {
          return target
            .$transaction([contextStatement(target, ctx), ...arg], options)
            .then((results) => (results as unknown[]).slice(1));
        }
        if (typeof arg !== "function") return target.$transaction(arg, options);
        const fn = arg as (tx: RawExecutor) => Promise<unknown>;
        return target.$transaction(async (tx: RawExecutor) => {
          await contextStatement(tx, ctx);
          return fn(tx);
        }, options);
      };
    },
  });
}
