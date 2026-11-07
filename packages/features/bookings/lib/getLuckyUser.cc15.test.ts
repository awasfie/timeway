import CalendarManagerMock from "@calcom/features/calendars/lib/__mocks__/CalendarManager";
import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { getLuckyUserService } from "@calcom/features/di/containers/LuckyUser";
import { buildUser } from "@calcom/lib/test/builder";
import { RRResetInterval, RRTimestampBasis } from "@calcom/prisma/enums";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// CC-15 (TW-T11): 6 bookings on a 3-member round-robin team, one member
// availability-blocked -> distribution 3/3/0, every assignment recorded.
const luckyUserService = getLuckyUserService();

const eventType = {
  id: 1,
  isRRWeightsEnabled: false,
  team: { rrResetInterval: RRResetInterval.MONTH, rrTimestampBasis: RRTimestampBasis.CREATED_AT },
  includeNoShowInRRCalculation: false,
};

const members = [1, 2, 3].map((id) => ({ id, email: `member${id}@example.com` }));
const BLOCKED_USER_ID = 3;

type Assignment = { userId: number; createdAt: Date };

async function runBookings(count: number, blockedIds: number[]) {
  const assignments: Assignment[] = [];
  const start = new Date("2021-06-20T08:00:00Z").getTime();
  CalendarManagerMock.getBusyCalendarTimes.mockResolvedValue({ success: true, data: [] });
  prismaMock.outOfOfficeEntry.findMany.mockResolvedValue([]);
  prismaMock.host.findMany.mockResolvedValue([]);
  prismaMock.booking.findMany.mockResolvedValue([]);

  for (let i = 0; i < count; i++) {
    const withBookings = members.map((m) =>
      buildUser({
        id: m.id,
        username: `member${m.id}`,
        email: m.email,
        bookings: assignments
          .filter((a) => a.userId === m.id)
          .map((a) => ({ createdAt: a.createdAt }))
          .reverse(),
      })
    );
    prismaMock.user.findMany.mockResolvedValue(withBookings);
    const availableUsers = withBookings.filter((u) => !blockedIds.includes(u.id));
    const lucky = await luckyUserService.getLuckyUser({
      availableUsers: availableUsers as [(typeof availableUsers)[number], ...typeof availableUsers],
      eventType,
      allRRHosts: [],
    });
    assignments.push({ userId: lucky.id, createdAt: new Date(start + i * 60_000) });
  }
  return assignments;
}

const tally = (a: Assignment[]) => [1, 2, 3].map((id) => a.filter((x) => x.userId === id).length);

describe("CC-15 round-robin distribution", () => {
  beforeAll(() => {
    vi.setSystemTime(new Date("2021-06-20T11:59:59Z"));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("6 bookings, 3 members, member 3 blocked -> 3/3/0 and recorded", async () => {
    const assignments = await runBookings(6, [BLOCKED_USER_ID]);
    expect(tally(assignments)).toEqual([3, 3, 0]);
    expect(assignments).toHaveLength(6);
    expect(assignments.map((a) => a.userId)).toEqual([1, 2, 1, 2, 1, 2]);
  });

  it("deterministic tiebreak: lowest userId first on a cold start", async () => {
    const assignments = await runBookings(1, []);
    expect(assignments[0].userId).toBe(1);
  });

  it("with nobody blocked, 6 bookings spread 2/2/2 in stable order", async () => {
    const assignments = await runBookings(6, []);
    expect(tally(assignments)).toEqual([2, 2, 2]);
    expect(assignments.map((a) => a.userId)).toEqual([1, 2, 3, 1, 2, 3]);
  });
});
