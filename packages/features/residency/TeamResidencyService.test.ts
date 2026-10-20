import { ErrorWithCode } from "@calcom/lib/errors";
import { getHttpStatusCode } from "@calcom/lib/server/getServerErrorFromUnknown";
import { RESIDENCY_CELLS, type ResidencyRegistry } from "@family/residency";
import { describe, expect, it, vi } from "vitest";
import { TeamResidencyService } from "./TeamResidencyService";

const ACTIVE: ResidencyRegistry = {
  "uae-1": { country: "AE", status: "active" },
  "ksa-1": { country: "SA", status: "planned" },
};
const inUae = new TeamResidencyService({ deployment: { cell: "uae-1" }, registry: ACTIVE });
const onDe = new TeamResidencyService({ deployment: { cell: null }, registry: ACTIVE });

function refusal(fn: () => unknown): { code: string; status: number } {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorWithCode);
    const err = e as ErrorWithCode;
    return { code: err.code, status: getHttpStatusCode(err) };
  }
  throw new Error("expected a residency refusal");
}

describe("non-clinic teams: behaviour unchanged", () => {
  it("passes a team with no residency fields on the DE plane", () => {
    expect(() => onDe.assertCreate({ name: "Acme", slug: "acme" })).not.toThrow();
  });

  it("passes a non-clinic vertical with a cell it does not need", () => {
    expect(() =>
      onDe.assert({ vertical: "salon", handlesPhi: false, residencyCell: "nowhere" })
    ).not.toThrow();
  });

  it("does not read the stored row when an update leaves the residency fields alone", async () => {
    const load = vi.fn();
    await expect(inUae.assertUpdate({ name: "Renamed" }, load)).resolves.toEqual({});
    expect(load).not.toHaveBeenCalled();
  });
});

describe("clinic teams: residency guard -> 422", () => {
  it("clinic without a cell -> residency_cell_required", () => {
    expect(refusal(() => inUae.assertCreate({ vertical: "clinic" }))).toEqual({
      code: "residency_cell_required",
      status: 422,
    });
  });

  it("unknown cell -> residency_cell_unknown (own keys only)", () => {
    expect(refusal(() => inUae.assert({ vertical: "clinic", residencyCell: "mars-1" })).code).toBe(
      "residency_cell_unknown"
    );
    expect(refusal(() => inUae.assert({ vertical: "clinic", residencyCell: "__proto__" })).code).toBe(
      "residency_cell_unknown"
    );
  });

  it("planned cell -> residency_cell_not_active", () => {
    expect(refusal(() => inUae.assert({ vertical: "clinic", residencyCell: "ksa-1" }))).toEqual({
      code: "residency_cell_not_active",
      status: 422,
    });
  });

  it("committed registry (uae-1 planned) refuses every clinic team", () => {
    const committed = new TeamResidencyService({ deployment: { cell: "uae-1" }, registry: RESIDENCY_CELLS });
    expect(refusal(() => committed.assert({ vertical: "clinic", residencyCell: "uae-1" })).code).toBe(
      "residency_cell_not_active"
    );
  });

  it("active cell on another deployment / the DE plane -> residency_cell_mismatch", () => {
    expect(refusal(() => onDe.assert({ vertical: "clinic", residencyCell: "uae-1" }))).toEqual({
      code: "residency_cell_mismatch",
      status: 422,
    });
  });

  it("active cell matching RESIDENCY_CELL -> ok, merged fields returned", () => {
    expect(inUae.assert({ vertical: " Clinic ", residencyCell: "uae-1" })).toEqual({
      vertical: " Clinic ",
      handlesPhi: null,
      residencyCell: "uae-1",
    });
  });

  it("handlesPhi=true is treated as clinic", () => {
    expect(refusal(() => inUae.assertCreate({ vertical: "salon", handlesPhi: true })).code).toBe(
      "residency_cell_required"
    );
  });

  it("reads Prisma `{ set }` update operations", () => {
    expect(refusal(() => inUae.assertCreate({ vertical: { set: "clinic" } })).code).toBe(
      "residency_cell_required"
    );
  });
});

describe("updates merge with the stored row", () => {
  it("flipping an existing non-clinic team to clinic is refused", async () => {
    const load = vi.fn().mockResolvedValue({ vertical: "salon", handlesPhi: null, residencyCell: null });
    await expect(inUae.assertUpdate({ vertical: "clinic" }, load)).rejects.toMatchObject({
      code: "residency_cell_required",
    });
  });

  it("setting handlesPhi on a stored team with a foreign cell is refused", async () => {
    const load = vi.fn().mockResolvedValue({ vertical: null, handlesPhi: null, residencyCell: "ksa-1" });
    await expect(inUae.assertUpdate({ handlesPhi: true }, load)).rejects.toMatchObject({
      code: "residency_cell_not_active",
    });
  });

  it("clearing the cell of a stored clinic team is refused", async () => {
    const load = vi.fn().mockResolvedValue({ vertical: "clinic", handlesPhi: null, residencyCell: "uae-1" });
    await expect(inUae.assertUpdate({ residencyCell: null }, load)).rejects.toMatchObject({
      code: "residency_cell_required",
    });
  });

  it("an allowed update returns the checked stored values as a write pin", async () => {
    const load = vi.fn().mockResolvedValue({ vertical: "salon", handlesPhi: null, residencyCell: null });
    await expect(inUae.assertUpdate({ vertical: "clinic", residencyCell: "uae-1" }, load)).resolves.toEqual({
      vertical: "salon",
      handlesPhi: null,
      residencyCell: null,
    });
  });
});
