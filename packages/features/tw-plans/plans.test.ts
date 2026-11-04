import { describe, expect, it } from "vitest";
import {
  canAddEventType,
  canAddMember,
  canUseCustomDomain,
  canUseProvider,
  effectiveEntitlements,
  normalizePlanCode,
  PLAN_ENTITLEMENTS,
  reconcileUsage,
  SPENAI_PACKAGE_MAP,
} from "./plans";
import { parsePlanBody } from "./setPlan";

describe("CM.3 catalog", () => {
  it("Free: 1 user, 2 event types, Camv only, no custom domain", () => {
    const e = effectiveEntitlements("free");
    expect(canAddMember(e, 0).ok).toBe(true);
    expect(canAddMember(e, 1)).toMatchObject({ ok: false, code: "plan_limit_members" });
    expect(canAddEventType(e, 1).ok).toBe(true);
    expect(canAddEventType(e, 2)).toMatchObject({ ok: false, code: "plan_limit_event_types" });
    expect(canUseProvider(e, "camv").ok).toBe(true);
    expect(canUseProvider(e, "google_meet").ok).toBe(false);
    expect(canUseCustomDomain(e).ok).toBe(false);
  });
  it("Pro adds Meet/custom URL, not Zoom, no custom domain", () => {
    const e = effectiveEntitlements("PRO");
    expect(canUseProvider(e, "google_meet").ok).toBe(true);
    expect(canUseProvider(e, "zoom").ok).toBe(false);
    expect(canAddEventType(e, 500).ok).toBe(true);
    expect(e.teamScheduling).toBe(false);
  });
  it("Teams: Zoom + team scheduling, no custom domain; Business: custom domain", () => {
    expect(effectiveEntitlements("teams").teamScheduling).toBe(true);
    expect(canUseCustomDomain(effectiveEntitlements("teams")).ok).toBe(false);
    expect(canUseCustomDomain(effectiveEntitlements("business")).ok).toBe(true);
    expect(canUseProvider(effectiveEntitlements("teams"), "zoom").ok).toBe(true);
  });
  it("seats override caps members on a seat-priced plan", () => {
    const e = effectiveEntitlements("teams", { seats: 3 });
    expect(canAddMember(e, 2).ok).toBe(true);
    expect(canAddMember(e, 3).ok).toBe(false);
  });
  it("limit overrides apply on top of the plan", () => {
    const e = effectiveEntitlements("free", { overrides: { maxEventTypes: 5 } });
    expect(canAddEventType(e, 4).ok).toBe(true);
  });
  it("catalog is not mutated by overrides", () => {
    effectiveEntitlements("free", { overrides: { providers: ["zoom"] } });
    expect(PLAN_ENTITLEMENTS.free.providers).toEqual(["camv"]);
  });
});

describe("non-catalog plan codes are unmetered (live orgs keep working)", () => {
  it.each([null, undefined, "", "agency", "starter"])("%s", (c) => {
    expect(normalizePlanCode(c as never)).toBeNull();
    const e = effectiveEntitlements(c as never);
    expect(canAddMember(e, 10_000).ok).toBe(true);
    expect(canAddEventType(e, 10_000).ok).toBe(true);
  });
});

describe("CM.7 Spenai package mapping", () => {
  it("Starter -> Teams x3, Growth -> Business x10, Scale -> Business x30", () => {
    expect(SPENAI_PACKAGE_MAP.starter).toEqual({ planCode: "teams", seats: 3 });
    expect(SPENAI_PACKAGE_MAP.growth).toEqual({ planCode: "business", seats: 10 });
    expect(SPENAI_PACKAGE_MAP.scale).toEqual({ planCode: "business", seats: 30 });
  });
  it("parsePlanBody maps packages, cancellation, direct codes, rejects junk", () => {
    expect(parsePlanBody({ spenai_package: "growth" })).toEqual({
      planCode: "business",
      seats: 10,
      source: "spenai:growth",
    });
    expect(parsePlanBody({ spenai_cancelled: true })).toEqual({
      planCode: "free",
      seats: null,
      source: "spenai:cancelled",
    });
    expect(parsePlanBody({ plan_code: "pro", seats: 4 })).toEqual({
      planCode: "pro",
      seats: 4,
      source: "api",
    });
    for (const bad of [
      null,
      [],
      {},
      { spenai_package: "enterprise" },
      { spenai_package: "__proto__" },
      { plan_code: "gold" },
      { plan_code: "pro", seats: 0 },
      { plan_code: "pro", seats: 1.5 },
    ])
      expect(parsePlanBody(bad)).toHaveProperty("error");
  });
});

describe("reconciler", () => {
  it("reports orgs over a limit (e.g. after a downgrade) and never mutates", () => {
    const e = effectiveEntitlements("free");
    expect(reconcileUsage(e, { members: 3, eventTypes: 5 })).toEqual(["members", "event_types"]);
    expect(reconcileUsage(e, { members: 1, eventTypes: 2 })).toEqual([]);
    expect(reconcileUsage(effectiveEntitlements("pro"), { members: 99, eventTypes: 99 })).toEqual([]);
  });
});
