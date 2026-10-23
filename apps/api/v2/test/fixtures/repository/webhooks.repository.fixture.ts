import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { TestingModule } from "@nestjs/testing";

import type { Prisma } from "@calcom/prisma/client";

export class WebhookRepositoryFixture {
  private primaReadClient: PrismaReadService["prisma"];
  private prismaWriteClient: PrismaWriteService["prisma"];

  constructor(module: TestingModule) {
    this.primaReadClient = module.get(PrismaReadService).prisma;
    this.prismaWriteClient = module.get(PrismaWriteService).prisma;
  }

  async create(data: Prisma.WebhookCreateInput) {
    return this.prismaWriteClient.webhook.create({ data });
  }

  async delete(webhookId: string) {
    return this.prismaWriteClient.webhook.delete({ where: { id: webhookId } });
  }

  async get(webhookId: string) {
    return this.prismaWriteClient.webhook.findUnique({ where: { id: webhookId } });
  }

  async countByEventTypeId(eventTypeId: number) {
    return this.prismaWriteClient.webhook.count({ where: { eventTypeId } });
  }

  async countByClientId(platformOAuthClientId: string) {
    return this.prismaWriteClient.webhook.count({ where: { platformOAuthClientId } });
  }
}
