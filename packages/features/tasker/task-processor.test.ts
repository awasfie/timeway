import { beforeEach, describe, expect, it, vi } from "vitest";

const { repo, handler } = vi.hoisted(() => ({
  repo: { getNextBatch: vi.fn(), succeed: vi.fn(), retry: vi.fn() },
  handler: vi.fn(),
}));

vi.mock("./repository", () => ({ Task: repo }));
vi.mock("./tasks", async () => {
  const actual = await vi.importActual<typeof import("./tasks")>("./tasks");
  return {
    default: {
      platformFeeUsage: async () => handler,
      webhookDelivery: async () => handler,
    },
    tasksConfig: actual.tasksConfig,
  };
});
vi.mock("@calcom/features/payments/gateway/platformFee", () => ({ sendPlatformFeeUsage: vi.fn() }));

import { TaskProcessor } from "./task-processor";
import { tasksConfig } from "./tasks";

function task(type: string, attempts: number) {
  return { id: `task-${type}-${attempts}`, type, payload: "{}", attempts, maxAttempts: 12, lastFailedAttemptAt: null };
}

describe("TaskProcessor retry interval", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    repo.getNextBatch.mockReset();
    repo.succeed.mockReset();
    repo.retry.mockReset();
    handler.mockReset();
  });

  it("platformFeeUsage backs off exponentially via retryIntervalMins, capped at 6 h", async () => {
    handler.mockRejectedValue(new Error("Passport /v1/usage answered 500"));
    const attempts = [0, 1, 2, 3, 5, 8, 11];
    repo.getNextBatch.mockResolvedValue(attempts.map((a) => task("platformFeeUsage", a)));

    await new TaskProcessor().processQueue();

    const byTask = Object.fromEntries(repo.retry.mock.calls.map(([arg]) => [arg.taskId, arg]));
    expect(attempts.map((a) => byTask[`task-platformFeeUsage-${a}`].minRetryIntervalMins)).toEqual([
      2, 4, 8, 16, 64, 360, 360,
    ]);
    expect(byTask["task-platformFeeUsage-0"].lastError).toBe("Passport /v1/usage answered 500");
    expect(repo.succeed).not.toHaveBeenCalled();
  });

  it("platformFeeUsage success marks the task succeeded and schedules no retry", async () => {
    handler.mockResolvedValue(undefined);
    repo.getNextBatch.mockResolvedValue([task("platformFeeUsage", 0)]);
    await new TaskProcessor().processQueue();
    expect(repo.succeed).toHaveBeenCalledWith("task-platformFeeUsage-0");
    expect(repo.retry).not.toHaveBeenCalled();
  });

  it("tasks with only minRetryIntervalMins keep the fixed interval", async () => {
    handler.mockRejectedValue(new Error("x"));
    repo.getNextBatch.mockResolvedValue([task("webhookDelivery", 4)]);
    await new TaskProcessor().processQueue();
    expect(repo.retry).toHaveBeenCalledWith(
      expect.objectContaining({ minRetryIntervalMins: tasksConfig.webhookDelivery.minRetryIntervalMins })
    );
  });

  it("platformFeeUsage keeps 12 attempts inside Passport's 35-day window", () => {
    const cfg = tasksConfig.platformFeeUsage;
    expect(cfg.maxAttempts).toBe(12);
    let totalMins = 0;
    for (let a = 1; a < cfg.maxAttempts; a++) totalMins += cfg.retryIntervalMins(a);
    expect(totalMins).toBeLessThan(35 * 24 * 60);
  });
});
