import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import {
  checkTenantResidency,
  type DeploymentContext,
  deploymentContextFromEnv,
  RESIDENCY_CELLS,
  type ResidencyErrorCode,
  type ResidencyRegistry,
} from "@family/residency";

export interface TeamResidencyFields {
  vertical?: string | null;
  handlesPhi?: boolean | null;
  residencyCell?: string | null;
}

export const teamResidencySelect = { vertical: true, handlesPhi: true, residencyCell: true } as const;

const RESIDENCY_KEYS = ["vertical", "handlesPhi", "residencyCell"] as const;

const ERROR_CODES: Record<ResidencyErrorCode, ErrorCode> = {
  residency_cell_required: ErrorCode.ResidencyCellRequired,
  residency_cell_unknown: ErrorCode.ResidencyCellUnknown,
  residency_cell_not_active: ErrorCode.ResidencyCellNotActive,
  residency_cell_mismatch: ErrorCode.ResidencyCellMismatch,
};

// Prisma write inputs may carry `{ set: value }` instead of a bare value.
function unwrap<T>(v: T | { set?: T } | undefined): T | undefined {
  if (v !== null && typeof v === "object" && "set" in v) return v.set;
  return v as T | undefined;
}

/**
 * WC-31 clinic-tenant residency guard for Team/organization writes (uae-cell.md section 7).
 * Every team or org create/update path calls `assert` before writing; non-clinic teams pass untouched.
 */
export class TeamResidencyService {
  private readonly deployment: DeploymentContext;
  private readonly registry: ResidencyRegistry;

  constructor(opts: { deployment?: DeploymentContext; registry?: ResidencyRegistry } = {}) {
    this.deployment = opts.deployment ?? deploymentContextFromEnv();
    this.registry = opts.registry ?? RESIDENCY_CELLS;
  }

  /** Reads the three residency fields out of a Prisma Team create/update `data` object. */
  static fieldsFromInput(data: object): TeamResidencyFields {
    const src = data as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of RESIDENCY_KEYS) {
      const v = unwrap(src[k]);
      if (v !== undefined) out[k] = v;
    }
    return out as TeamResidencyFields;
  }

  static touchesResidency(data: object): boolean {
    return Object.keys(TeamResidencyService.fieldsFromInput(data)).length > 0;
  }

  /**
   * Merges `input` over `existing` (undefined = keep stored value, null = clear) and refuses the
   * merged tenant with ErrorWithCode(<residency code>) -> HTTP 422. `existing` is omitted on create.
   */
  assert(input: TeamResidencyFields, existing?: TeamResidencyFields | null): TeamResidencyFields {
    const merged: TeamResidencyFields = {
      vertical: input.vertical !== undefined ? input.vertical : (existing?.vertical ?? null),
      handlesPhi: input.handlesPhi !== undefined ? input.handlesPhi : (existing?.handlesPhi ?? null),
      residencyCell:
        input.residencyCell !== undefined ? input.residencyCell : (existing?.residencyCell ?? null),
    };
    const verdict = checkTenantResidency(merged, this.deployment, this.registry);
    if (!verdict.ok) throw new ErrorWithCode(ERROR_CODES[verdict.code], verdict.code);
    return merged;
  }

  /** Guards a Prisma Team create `data` object. */
  assertCreate(data: object): void {
    this.assert(TeamResidencyService.fieldsFromInput(data));
  }

  /**
   * Guards a Prisma Team update `data` object. Returns a `where` fragment pinning the residency values
   * that were checked, so a concurrent writer cannot slip a clinic flag past the guard (the update then
   * matches no row). Returns {} when `data` does not touch the residency fields.
   */
  async assertUpdate(
    data: object,
    loadExisting: () => Promise<TeamResidencyFields | null>
  ): Promise<TeamResidencyFields> {
    if (!TeamResidencyService.touchesResidency(data)) return {};
    const existing = await loadExisting();
    this.assert(TeamResidencyService.fieldsFromInput(data), existing);
    if (!existing) return {};
    return {
      vertical: existing.vertical ?? null,
      handlesPhi: existing.handlesPhi ?? null,
      residencyCell: existing.residencyCell ?? null,
    };
  }
}
