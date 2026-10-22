/** R7 / D8: poll refresh every 30 s for 10 min, then offer "Check again". */
export const POLL_INTERVAL_MS = 30_000;
export const POLL_WINDOW_MS = 10 * 60_000;

export type PollState = "idle" | "polling" | "stopped";

export function shouldPoll(status: string | undefined, startedAt: number | null, now: number): boolean {
  return status === "pending_dns" && startedAt !== null && now - startedAt < POLL_WINDOW_MS;
}
