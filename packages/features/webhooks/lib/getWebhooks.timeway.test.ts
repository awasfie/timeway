import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@calcom/prisma";
import { WebhookTriggerEvents } from "@calcom/prisma/enums";

import getWebhooks from "./getWebhooks";
import { WebhookVersion } from "./interface/IWebhookRepository";
import sendPayload from "./sendPayload";

vi.mock("@calcom/prisma", () => ({ default: {} }));

function fakePrisma(eventType: unknown) {
  const findUnique = vi.fn().mockResolvedValue(eventType);
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = { eventType: { findUnique }, webhook: { findMany } } as unknown as PrismaClient;
  return { prisma, findUnique, findMany };
}

function teamIdsQueried(findMany: ReturnType<typeof vi.fn>): number[] {
  const where = findMany.mock.calls[0][0].where;
  const teamClause = where.OR.find((c: Record<string, unknown>) => "teamId" in c);
  return teamClause.teamId.in;
}

describe("getWebhooks team scope (FIX-TW-AWS-2-WH)", () => {
  it("includes the event type's own team when callers pass teamId null", async () => {
    const { prisma, findMany } = fakePrisma({
      parentId: null,
      teamId: 2,
      team: { parentId: null },
      parent: null,
    });
    await getWebhooks(
      {
        userId: 2,
        eventTypeId: 11,
        triggerEvent: WebhookTriggerEvents.BOOKING_CREATED,
        teamId: null,
        orgId: null,
      },
      prisma
    );
    expect(teamIdsQueried(findMany)).toContain(2);
  });

  it("includes the org of the team", async () => {
    const { prisma, findMany } = fakePrisma({
      parentId: null,
      teamId: 2,
      team: { parentId: 7 },
      parent: null,
    });
    await getWebhooks({ eventTypeId: 11, triggerEvent: WebhookTriggerEvents.BOOKING_CANCELLED }, prisma);
    expect(teamIdsQueried(findMany)).toEqual(expect.arrayContaining([2, 7]));
  });

  it("resolves the team of a managed child event type through its parent", async () => {
    const { prisma, findMany } = fakePrisma({
      parentId: 40,
      teamId: null,
      team: null,
      parent: { teamId: 3, team: { parentId: null } },
    });
    await getWebhooks(
      { userId: 5, eventTypeId: 41, triggerEvent: WebhookTriggerEvents.BOOKING_CREATED },
      prisma
    );
    const where = findMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ eventTypeId: 40 });
    expect(teamIdsQueried(findMany)).toContain(3);
  });

  it("adds no team for a personal event type and skips the lookup without an event type", async () => {
    const personal = fakePrisma({ parentId: null, teamId: null, team: null, parent: null });
    await getWebhooks(
      { userId: 5, eventTypeId: 9, triggerEvent: WebhookTriggerEvents.BOOKING_CREATED },
      personal.prisma
    );
    expect(teamIdsQueried(personal.findMany)).toEqual([0, 0]);

    const none = fakePrisma(null);
    await getWebhooks({ userId: 5, triggerEvent: WebhookTriggerEvents.BOOKING_CREATED }, none.prisma);
    expect(none.findUnique).not.toHaveBeenCalled();
  });
});

describe("sendPayload delivery log (FIX-TW-AWS-2-WH)", () => {
  const webhook = {
    subscriberUrl: "https://hooks.example.com/wp-json/aws/v1/booking?token=abc",
    appId: null,
    payloadTemplate: null,
    version: WebhookVersion.V_2021_10_20,
  };
  const data = {
    title: "T",
    uid: "uid-123",
    startTime: "2026-10-21T05:00:00Z",
    endTime: "2026-10-21T05:30:00Z",
    organizer: { email: "o@example.com", name: "O", timeZone: "UTC", language: { locale: "en" } },
    attendees: [],
  };
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("logs host, trigger, booking uid and status, without the URL path, query or secret", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    // @ts-expect-error minimal event payload for the test
    const res = await sendPayload("s3cret", "BOOKING_CREATED", new Date().toISOString(), webhook, data);
    expect(res.status).toBe(200);
    expect(info).toHaveBeenCalledTimes(1);
    const logged = info.mock.calls[0][0] as string;
    expect(JSON.parse(logged)).toEqual({
      level: "info",
      msg: "webhook_delivery",
      subscriberHost: "hooks.example.com",
      triggerEvent: "BOOKING_CREATED",
      bookingUid: "uid-123",
      status: 200,
    });
    expect(logged).not.toContain("token=abc");
    expect(logged).not.toContain("s3cret");
  });

  it("logs a non-2xx status and a network error, and still rethrows the error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    // @ts-expect-error minimal event payload for the test
    await sendPayload("s", "BOOKING_CANCELLED", new Date().toISOString(), webhook, data);
    expect(JSON.parse(info.mock.calls[0][0] as string).status).toBe(401);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    // @ts-expect-error minimal event payload for the test
    await expect(sendPayload("s", "BOOKING_CREATED", "x", webhook, data)).rejects.toThrow("ECONNREFUSED");
    const last = JSON.parse(info.mock.calls[1][0] as string);
    expect(last).toMatchObject({ status: null, error: "ECONNREFUSED" });
  });
});
