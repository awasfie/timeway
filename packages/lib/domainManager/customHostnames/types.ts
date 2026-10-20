export type CustomHostnameStatus = "pending_dns" | "active" | "failed";

export type CustomHostnameRow = {
  id: string;
  orgId: string;
  hostname: string;
  status: CustomHostnameStatus;
  sslStatus: string;
  lastError: string | null;
  cnameVerifiedAt: Date | null;
  lastCheckedAt: Date | null;
  activatedAt: Date | null;
  createdAt: Date;
};

export type CustomHostnameUpdate = Partial<
  Pick<
    CustomHostnameRow,
    "status" | "sslStatus" | "lastError" | "cnameVerifiedAt" | "lastCheckedAt" | "activatedAt"
  >
>;

export class HostnameTakenError extends Error {
  constructor() {
    super("custom hostname already registered");
    this.name = "HostnameTakenError";
  }
}

export interface CustomHostnameRepositoryPort {
  findByOrg(orgId: string): Promise<CustomHostnameRow | null>;
  create(orgId: string, hostname: string): Promise<CustomHostnameRow>;
  update(orgId: string, id: string, data: CustomHostnameUpdate): Promise<CustomHostnameRow>;
  deleteByOrg(orgId: string): Promise<number>;
  /** Cross-org, platform context: the approval endpoint. Returns only the fields it needs. */
  findForApproval(hostname: string): Promise<Pick<CustomHostnameRow, "status" | "cnameVerifiedAt"> | null>;
  /** Cross-org, platform context: cleanup candidates. */
  listNeverActivatedBefore(
    cutoff: Date
  ): Promise<Pick<CustomHostnameRow, "id" | "orgId" | "hostname" | "createdAt">[]>;
  /** Deletes one row only if it is still never-activated and older than cutoff. */
  deleteIfStillStale(id: string, cutoff: Date): Promise<boolean>;
  /** Org ids where this user is owner/admin. */
  listAdminOrgIds(userId: number): Promise<string[]>;
}
