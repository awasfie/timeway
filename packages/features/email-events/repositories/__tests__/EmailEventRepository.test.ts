import { describe, expect, it, vi } from "vitest";
import type { EmailEventRow } from "../../lib/normalizeSendgridEvents";
import { EmailEventRepository } from "../EmailEventRepository";

const row = (id: string): EmailEventRow => ({
  sgEventId: id,
  sgMessageId: "m1",
  event: "delivered",
  bookingUid: null,
  recipientDomain: "example.com",
  reason: null,
  occurredAt: new Date(0),
});

/** Stand-in for Postgres: the unique sgEventId index with ON CONFLICT DO NOTHING. */
function fakePrisma() {
  const stored = new Map<string, EmailEventRow>();
  const createMany = vi.fn(
    async ({ data, skipDuplicates }: { data: EmailEventRow[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const d of data) {
        if (stored.has(d.sgEventId)) {
          if (!skipDuplicates) throw new Error("unique violation");
          continue;
        }
        stored.set(d.sgEventId, d);
        count++;
      }
      return { count };
    }
  );
  return { stored, createMany, client: { emailEvent: { createMany } } };
}

describe("EmailEventRepository.insertMany", () => {
  it("is idempotent across a re-delivered batch", async () => {
    const fake = fakePrisma();
    const repo = new EmailEventRepository(
      fake.client as unknown as ConstructorParameters<typeof EmailEventRepository>[0]
    );
    expect(await repo.insertMany([row("a"), row("b")])).toBe(2);
    expect(await repo.insertMany([row("a"), row("b"), row("c")])).toBe(1);
    expect(fake.stored.size).toBe(3);
    expect(fake.createMany).toHaveBeenLastCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it("does not hit the database for an empty batch", async () => {
    const fake = fakePrisma();
    const repo = new EmailEventRepository(
      fake.client as unknown as ConstructorParameters<typeof EmailEventRepository>[0]
    );
    expect(await repo.insertMany([])).toBe(0);
    expect(fake.createMany).not.toHaveBeenCalled();
  });
});
