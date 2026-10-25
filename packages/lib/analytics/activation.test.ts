import { describe, expect, it, vi } from "vitest";
import { captureFirstBookingReceived } from "./activation";
import { toAnalyticsLocale } from "./locale";

const ORG = "5f94bad6-0000-4000-8000-000000000001";
const env = { host: "https://ph.example/", key: "phc_test" };

function setup(rowCount: number, over: Partial<Parameters<typeof captureFirstBookingReceived>[0]> = {}) {
  const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
  const bookingFindMany = vi.fn(async () => Array.from({ length: rowCount }, (_, i) => ({ id: i + 1 })));
  const input = {
    twOrgId: ORG,
    organizerUuid: "user-uuid-1",
    organizerLocale: "ar",
    isDryRun: false,
    isReschedule: false,
    bookingFindMany,
    env,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...over,
  };
  return { fetchImpl, bookingFindMany, input };
}

describe("captureFirstBookingReceived", () => {
  it("emits one activation with locale when the org has exactly one booking", async () => {
    const { fetchImpl, input } = setup(1);
    expect(await captureFirstBookingReceived(input)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("https://ph.example/capture/");
    const body = JSON.parse(init.body);
    expect(body.event).toBe("activation");
    expect(body.distinct_id).toBe("user-uuid-1");
    expect(body.properties).toMatchObject({
      activation_event: "first_booking_received",
      product: "timeway",
      locale: "ar",
      $insert_id: `activation:timeway:${ORG}`,
      $groups: { org: ORG },
    });
  });

  it("is idempotent: second and later bookings emit nothing", async () => {
    const { fetchImpl, input } = setup(2);
    expect(await captureFirstBookingReceived(input)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["no org", { twOrgId: null }],
    ["dry run", { isDryRun: true }],
    ["reschedule", { isReschedule: true }],
  ])("skips: %s", async (_n, over) => {
    const { fetchImpl, bookingFindMany, input } = setup(1, over);
    expect(await captureFirstBookingReceived(input)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(bookingFindMany).not.toHaveBeenCalled();
  });

  it("no key: disabled, no DB read", async () => {
    const { fetchImpl, bookingFindMany, input } = setup(1, { env: { host: "https://ph.example", key: "" } });
    expect(await captureFirstBookingReceived(input)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(bookingFindMany).not.toHaveBeenCalled();
  });

  it("never throws when the DB read fails", async () => {
    const { input } = setup(1, {
      bookingFindMany: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    expect(await captureFirstBookingReceived(input)).toBe(false);
  });

  it("maps locales to ar/en or null", () => {
    expect(toAnalyticsLocale("ar-EG")).toBe("ar");
    expect(toAnalyticsLocale("EN")).toBe("en");
    expect(toAnalyticsLocale("fr")).toBeNull();
    expect(toAnalyticsLocale(undefined)).toBeNull();
  });
});
