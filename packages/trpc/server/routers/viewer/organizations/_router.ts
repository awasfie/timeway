import authedProcedure from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";
import { ZCustomDomainAddInput, ZCustomDomainOrgInput } from "./customDomain.schema";

const customDomainRouter = router({
  get: authedProcedure.input(ZCustomDomainOrgInput).query(async ({ ctx, input }) => {
    const { customDomainHandler } = await import("./customDomain.handler");
    return customDomainHandler("get", { ctx, input });
  }),
  add: authedProcedure.input(ZCustomDomainAddInput).mutation(async ({ ctx, input }) => {
    const { customDomainHandler } = await import("./customDomain.handler");
    return customDomainHandler("add", { ctx, input });
  }),
  refresh: authedProcedure.input(ZCustomDomainOrgInput).mutation(async ({ ctx, input }) => {
    const { customDomainHandler } = await import("./customDomain.handler");
    return customDomainHandler("refresh", { ctx, input });
  }),
  remove: authedProcedure.input(ZCustomDomainOrgInput).mutation(async ({ ctx, input }) => {
    const { customDomainHandler } = await import("./customDomain.handler");
    return customDomainHandler("remove", { ctx, input });
  }),
});

export const organizationsRouter = router({
  customDomain: customDomainRouter,
});
