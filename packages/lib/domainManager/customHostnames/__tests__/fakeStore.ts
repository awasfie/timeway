import type { CustomHostnameRepositoryPort, CustomHostnameRow, CustomHostnameUpdate } from "../types";
import { HostnameTakenError } from "../types";

/** In-memory port with the same uniqueness and stale-delete semantics as the Prisma repository. */
export class FakeCustomHostnameRepository implements CustomHostnameRepositoryPort {
  rows = new Map<string, CustomHostnameRow>();
  deleteCalls: string[] = [];
  private seq = 0;

  constructor(private readonly clock: () => Date = () => new Date()) {}

  seed(row: Partial<CustomHostnameRow> & Pick<CustomHostnameRow, "orgId" | "hostname">): CustomHostnameRow {
    const full: CustomHostnameRow = {
      id: `row-${++this.seq}`,
      status: "pending_dns",
      sslStatus: "none",
      lastError: null,
      cnameVerifiedAt: null,
      lastCheckedAt: null,
      activatedAt: null,
      createdAt: this.clock(),
      ...row,
    };
    this.rows.set(full.id, full);
    return full;
  }

  async findByOrg(orgId: string) {
    return Array.from(this.rows.values()).find((r) => r.orgId === orgId) ?? null;
  }

  async create(orgId: string, hostname: string) {
    if (Array.from(this.rows.values()).some((r) => r.hostname === hostname)) throw new HostnameTakenError();
    return this.seed({ orgId, hostname });
  }

  async update(orgId: string, id: string, data: CustomHostnameUpdate) {
    const row = this.rows.get(id);
    if (!row || row.orgId !== orgId) throw new Error(`no row ${id} for org ${orgId}`);
    const next = { ...row, ...data };
    this.rows.set(id, next);
    return next;
  }

  async deleteByOrg(orgId: string) {
    let n = 0;
    for (const [id, r] of Array.from(this.rows)) {
      if (r.orgId === orgId) {
        this.rows.delete(id);
        n++;
      }
    }
    return n;
  }

  async findForApproval(hostname: string) {
    const row = Array.from(this.rows.values()).find((r) => r.hostname === hostname);
    return row ? { status: row.status, cnameVerifiedAt: row.cnameVerifiedAt } : null;
  }

  private isStale(r: CustomHostnameRow, cutoff: Date) {
    return r.status !== "active" && r.activatedAt === null && r.createdAt < cutoff;
  }

  async listNeverActivatedBefore(cutoff: Date) {
    return Array.from(this.rows.values())
      .filter((r) => this.isStale(r, cutoff))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(({ id, orgId, hostname, createdAt }) => ({ id, orgId, hostname, createdAt }));
  }

  async deleteIfStillStale(id: string, cutoff: Date) {
    this.deleteCalls.push(id);
    const row = this.rows.get(id);
    if (!row || !this.isStale(row, cutoff)) return false;
    this.rows.delete(id);
    return true;
  }

  async listAdminOrgIds() {
    return [];
  }
}
