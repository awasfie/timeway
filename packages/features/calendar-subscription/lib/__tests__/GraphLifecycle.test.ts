import { describe, expect, test, vi } from "vitest";

vi.mock("@calcom/app-store/delegationCredential", () => ({ getCredentialForSelectedCalendar: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ metrics: { count: vi.fn(), distribution: vi.fn() } }));

import { CalendarSubscriptionService } from "../CalendarSubscriptionService";

function make() {
  const cal = { id: "sc1", channelId: "sub1" };
  const repo = {
    findByChannelId: vi.fn(async (id: string) => (id === "sub1" ? cal : null)),
    updateSubscription: vi.fn(async () => ({})),
  };
  // biome-ignore lint/suspicious/noExplicitAny: test deps
  const svc = new CalendarSubscriptionService({ selectedCalendarRepository: repo } as any);
  const subscribe = vi.spyOn(svc, "subscribe").mockResolvedValue(undefined);
  // biome-ignore lint/suspicious/noExplicitAny: test spy
  const processEvents = vi.spyOn(svc, "processEvents").mockResolvedValue({} as any);
  return { svc, repo, subscribe, processEvents };
}

describe("WC-TW-2 Graph lifecycle", () => {
  test("reauthorizationRequired renews in place", async () => {
    const { svc, subscribe, repo } = make();
    const r = await svc.processGraphLifecycle(
      [{ subscriptionId: "sub1", lifecycleEvent: "reauthorizationRequired", clientState: "t" }],
      "t"
    );
    expect(subscribe).toHaveBeenCalledWith("sc1");
    expect(repo.updateSubscription).not.toHaveBeenCalled();
    expect(r).toEqual({ handled: 1, skipped: 0 });
  });
  test("subscriptionRemoved clears expiration then re-creates", async () => {
    const { svc, subscribe, repo } = make();
    await svc.processGraphLifecycle(
      [{ subscriptionId: "sub1", lifecycleEvent: "subscriptionRemoved", clientState: "t" }],
      "t"
    );
    expect(repo.updateSubscription).toHaveBeenCalledWith("sc1", { channelExpiration: null });
    expect(subscribe).toHaveBeenCalledWith("sc1");
  });
  test("missed triggers delta resync", async () => {
    const { svc, processEvents } = make();
    await svc.processGraphLifecycle([{ subscriptionId: "sub1", lifecycleEvent: "missed", clientState: "t" }], "t");
    expect(processEvents).toHaveBeenCalled();
  });
  test("bad clientState, unknown sub, missing token are skipped", async () => {
    const { svc, subscribe, processEvents } = make();
    const r = await svc.processGraphLifecycle(
      [
        { subscriptionId: "sub1", lifecycleEvent: "missed", clientState: "x" },
        { subscriptionId: "nope", lifecycleEvent: "missed", clientState: "t" },
      ],
      "t"
    );
    const r2 = await svc.processGraphLifecycle(
      [{ subscriptionId: "sub1", lifecycleEvent: "missed", clientState: "t" }],
      null
    );
    expect(r).toEqual({ handled: 0, skipped: 2 });
    expect(r2).toEqual({ handled: 0, skipped: 1 });
    expect(subscribe).not.toHaveBeenCalled();
    expect(processEvents).not.toHaveBeenCalled();
  });
});
