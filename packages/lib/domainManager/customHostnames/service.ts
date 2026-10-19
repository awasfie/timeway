import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";

import type { CnameLookup, HttpsProbe } from "./probes";
import type { CustomHostnameRepositoryPort, CustomHostnameRow } from "./repository";
import { HostnameTakenError } from "./repository";
import { normalizeHostname, validateCustomHostname } from "./validate";

/** R5: customers CNAME their subdomain to this Timeway-owned, DNS-only name. */
/** Header carrying TW_DOMAIN_APPROVE_SECRET on approval requests (R4). */
export const APPROVE_SECRET_HEADER = "x-tw-domain-approve-secret";

export const DEFAULT_CNAME_TARGET = "customers.timeway.co";

export function getCnameTarget(): string {
  return normalizeHostname(process.env.TW_CUSTOM_DOMAIN_CNAME_TARGET || DEFAULT_CNAME_TARGET);
}

export function isCustomDomainsEnabled(): boolean {
  return process.env.TW_CUSTOM_DOMAINS_ENABLED === "true";
}

export type CustomHostnameServiceDeps = {
  repository: CustomHostnameRepositoryPort;
  lookupCname: CnameLookup;
  probeHttps: HttpsProbe;
  cnameTarget?: string;
  now?: () => Date;
};

export class CustomHostnameService {
  private readonly cnameTarget: string;
  private readonly now: () => Date;

  constructor(private readonly deps: CustomHostnameServiceDeps) {
    this.cnameTarget = deps.cnameTarget ?? getCnameTarget();
    this.now = deps.now ?? (() => new Date());
  }

  get(orgId: string): Promise<CustomHostnameRow | null> {
    return this.deps.repository.findByOrg(orgId);
  }

  async addHostname(orgId: string, input: string): Promise<CustomHostnameRow> {
    const result = validateCustomHostname(input);
    if (!result.ok) {
      throw new ErrorWithCode(ErrorCode.BadRequest, `custom hostname rejected: ${result.reason}`, {
        reason: result.reason,
      });
    }
    const existing = await this.deps.repository.findByOrg(orgId);
    if (existing) {
      throw new ErrorWithCode(ErrorCode.BadRequest, "organization already has a custom hostname; remove it first", {
        reason: "one_per_org",
      });
    }
    try {
      return await this.deps.repository.create(orgId, result.hostname);
    } catch (e) {
      if (e instanceof HostnameTakenError) {
        throw new ErrorWithCode(ErrorCode.BadRequest, "custom hostname already registered", {
          reason: "hostname_taken",
        });
      }
      throw e;
    }
  }

  /**
   * R7: pending_dns -> (CNAME ok) cnameVerifiedAt set, approval endpoint now says yes
   *     -> (HTTPS probe ok) active / issued.
   * A lost CNAME on an active row marks it failed (approval stops, cert renewals stop).
   */
  async refresh(orgId: string): Promise<CustomHostnameRow | null> {
    const row = await this.deps.repository.findByOrg(orgId);
    if (!row) return null;
    const now = this.now();

    let targets: string[];
    try {
      targets = (await this.deps.lookupCname(row.hostname)).map(normalizeHostname);
    } catch (e) {
      return this.deps.repository.update(orgId, row.id, {
        lastCheckedAt: now,
        lastError: `dns_lookup_failed: ${e instanceof Error ? e.message : "unknown"}`,
      });
    }

    if (!targets.includes(this.cnameTarget)) {
      return this.deps.repository.update(orgId, row.id, {
        status: row.status === "active" ? "failed" : row.status === "failed" ? "failed" : "pending_dns",
        cnameVerifiedAt: null,
        sslStatus: row.status === "active" ? row.sslStatus : "none",
        lastCheckedAt: now,
        lastError: targets.length ? `cname_mismatch: points to ${targets[0]}` : "cname_missing",
      });
    }

    const probe = await this.deps.probeHttps(row.hostname);
    if (probe.ok) {
      return this.deps.repository.update(orgId, row.id, {
        status: "active",
        sslStatus: "issued",
        cnameVerifiedAt: row.cnameVerifiedAt ?? now,
        activatedAt: row.activatedAt ?? now,
        lastCheckedAt: now,
        lastError: null,
      });
    }
    return this.deps.repository.update(orgId, row.id, {
      status: row.status === "active" ? "active" : "pending_dns",
      sslStatus: row.status === "active" ? row.sslStatus : "pending",
      cnameVerifiedAt: row.cnameVerifiedAt ?? now,
      lastCheckedAt: now,
      lastError: `https_probe: ${probe.error}`,
    });
  }

  async remove(orgId: string): Promise<boolean> {
    return (await this.deps.repository.deleteByOrg(orgId)) > 0;
  }
}

/**
 * R4: the proxy asks before issuing a cert. Approve active rows, and pending rows
 * whose CNAME was already verified (guards the LE failed-validation limit).
 */
export async function isHostnameApproved(
  repository: Pick<CustomHostnameRepositoryPort, "findForApproval">,
  domain: string
): Promise<boolean> {
  const hostname = normalizeHostname(domain);
  if (!hostname || hostname.length > 253) return false;
  const row = await repository.findForApproval(hostname);
  if (!row) return false;
  if (row.status === "active") return true;
  return row.status === "pending_dns" && row.cnameVerifiedAt !== null;
}

export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export type CleanupResult = {
  dryRun: boolean;
  candidates: number;
  deleted: number;
  hostnames: string[];
};

/** R8: rows never activated 48 h after creation; deleted one at a time, re-checked per row. */
export async function cleanupStaleHostnames(
  repository: Pick<CustomHostnameRepositoryPort, "listNeverActivatedBefore" | "deleteIfStillStale">,
  opts: { dryRun: boolean; now?: Date }
): Promise<CleanupResult> {
  const cutoff = new Date((opts.now ?? new Date()).getTime() - STALE_AFTER_MS);
  const candidates = await repository.listNeverActivatedBefore(cutoff);
  let deleted = 0;
  if (!opts.dryRun) {
    for (const row of candidates) {
      if (await repository.deleteIfStillStale(row.id, cutoff)) deleted++;
    }
  }
  return {
    dryRun: opts.dryRun,
    candidates: candidates.length,
    deleted,
    hostnames: candidates.map((r) => r.hostname),
  };
}
