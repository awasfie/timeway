import type { PrismaClient } from "@calcom/prisma/client";
import { Prisma } from "@calcom/prisma/client";

export const customHostnameSelect = {
  id: true,
  organizationId: true,
  hostname: true,
  cfHostnameId: true,
  status: true,
  sslStatus: true,
  verificationErrors: true,
  createdAt: true,
  lastCheckedAt: true,
  activatedAt: true,
} as const;

export interface CustomHostnameRow {
  id: string;
  organizationId: number;
  hostname: string;
  cfHostnameId: string | null;
  status: string;
  sslStatus: string | null;
  verificationErrors: unknown;
  createdAt: Date;
  lastCheckedAt: Date | null;
  activatedAt: Date | null;
}

export interface CustomHostnameUpdate {
  cfHostnameId?: string | null;
  status?: string;
  sslStatus?: string | null;
  verificationErrors?: Prisma.InputJsonValue | null;
  lastCheckedAt?: Date | null;
  activatedAt?: Date | null;
}

export interface ICustomHostnameRepository {
  findByOrganizationId(organizationId: number): Promise<CustomHostnameRow | null>;
  findByHostname(hostname: string): Promise<CustomHostnameRow | null>;
  create(data: { organizationId: number; hostname: string }): Promise<CustomHostnameRow>;
  update(id: string, data: CustomHostnameUpdate): Promise<CustomHostnameRow>;
  deleteById(id: string): Promise<void>;
  /** Rows never activated and created at or before `createdBefore` (D9). */
  findNeverActivatedCreatedBefore(createdBefore: Date): Promise<CustomHostnameRow[]>;
  listRefs(): Promise<{ hostname: string; cfHostnameId: string | null }[]>;
}

export class PrismaCustomHostnameRepository implements ICustomHostnameRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByOrganizationId(organizationId: number) {
    return this.prisma.twCustomHostname.findUnique({
      where: { organizationId },
      select: customHostnameSelect,
    });
  }

  findByHostname(hostname: string) {
    return this.prisma.twCustomHostname.findUnique({ where: { hostname }, select: customHostnameSelect });
  }

  create(data: { organizationId: number; hostname: string }) {
    return this.prisma.twCustomHostname.create({ data, select: customHostnameSelect });
  }

  update(id: string, data: CustomHostnameUpdate) {
    const { verificationErrors, ...rest } = data;
    return this.prisma.twCustomHostname.update({
      where: { id },
      data: {
        ...rest,
        ...(verificationErrors !== undefined && {
          verificationErrors: verificationErrors === null ? Prisma.DbNull : verificationErrors,
        }),
      },
      select: customHostnameSelect,
    });
  }

  async deleteById(id: string) {
    // Single-row delete by primary key; D9 forbids bulk deletes.
    await this.prisma.twCustomHostname.delete({ where: { id }, select: { id: true } });
  }

  findNeverActivatedCreatedBefore(createdBefore: Date) {
    return this.prisma.twCustomHostname.findMany({
      where: { activatedAt: null, createdAt: { lte: createdBefore } },
      select: customHostnameSelect,
      orderBy: { createdAt: "asc" },
    });
  }

  listRefs() {
    return this.prisma.twCustomHostname.findMany({ select: { hostname: true, cfHostnameId: true } });
  }
}
