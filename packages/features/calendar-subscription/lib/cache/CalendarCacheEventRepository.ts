import type { ICalendarCacheEventRepository } from "@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventRepository.interface";
import type { PrismaClient } from "@calcom/prisma";
import type { CalendarCacheEvent } from "@calcom/prisma/client";

export class CalendarCacheEventRepository implements ICalendarCacheEventRepository {
  constructor(private prismaClient: PrismaClient) {}

  async findAllBySelectedCalendarIdsBetween(
    selectedCalendarId: string[],
    start: Date,
    end: Date
  ): Promise<Pick<CalendarCacheEvent, "start" | "end" | "timeZone">[]> {
    return this.prismaClient.calendarCacheEvent.findMany({
      where: {
        selectedCalendarId: {
          in: selectedCalendarId,
        },
        AND: [{ start: { lt: end } }, { end: { gt: start } }],
      },
      select: {
        start: true,
        end: true,
        timeZone: true,
      },
    });
  }

  async upsertMany(events: CalendarCacheEvent[]) {
    if (events.length === 0) {
      return;
    }
    // WC-TW-2: idempotent — collapse duplicates in one batch (last write per
    // provider event id wins) and refresh every provider-owned field, incl. iCalUID.
    const byKey = new Map<string, CalendarCacheEvent>();
    for (const event of events) {
      byKey.set(`${event.selectedCalendarId}\u0000${event.externalId}`, event);
    }
    // lack of upsertMany in prisma
    return Promise.allSettled(
      Array.from(byKey.values()).map((event) => {
        return this.prismaClient.calendarCacheEvent.upsert({
          where: {
            selectedCalendarId_externalId: {
              externalId: event.externalId,
              selectedCalendarId: event.selectedCalendarId,
            },
          },
          update: {
            start: event.start,
            end: event.end,
            summary: event.summary,
            description: event.description,
            location: event.location,
            isAllDay: event.isAllDay,
            timeZone: event.timeZone,
            externalEtag: event.externalEtag,
            iCalUID: event.iCalUID,
            iCalSequence: event.iCalSequence,
            status: event.status,
            recurringEventId: event.recurringEventId,
            originalStartTime: event.originalStartTime,
            externalUpdatedAt: event.externalUpdatedAt,
          },
          create: event,
        });
      })
    );
  }

  async deleteMany(events: Pick<CalendarCacheEvent, "externalId" | "selectedCalendarId">[]) {
    // Only delete events with externalId and selectedCalendarId
    const conditions = events.filter((c) => c.externalId && c.selectedCalendarId);
    if (conditions.length === 0) {
      return;
    }

    return this.prismaClient.calendarCacheEvent.deleteMany({
      where: {
        OR: conditions,
      },
    });
  }

  async deleteAllBySelectedCalendarId(selectedCalendarId: string) {
    if (!selectedCalendarId) {
      return;
    }

    return this.prismaClient.calendarCacheEvent.deleteMany({
      where: {
        selectedCalendarId,
      },
    });
  }

  async deleteStale() {
    return this.prismaClient.calendarCacheEvent.deleteMany({
      where: {
        end: { lte: new Date() },
      },
    });
  }
}
