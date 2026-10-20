import { z } from "zod";

export const ZCustomDomainOrgInput = z.object({ orgId: z.string().uuid() });

export const ZCustomDomainAddInput = ZCustomDomainOrgInput.extend({
  hostname: z.string().min(1).max(253),
});

export type TCustomDomainOrgInput = z.infer<typeof ZCustomDomainOrgInput>;
export type TCustomDomainAddInput = z.infer<typeof ZCustomDomainAddInput>;
