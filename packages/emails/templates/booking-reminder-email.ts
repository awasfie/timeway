import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import renderEmail from "../src/renderEmail";
import AttendeeScheduledEmail from "./attendee-scheduled-email";
import OrganizerScheduledEmail from "./organizer-scheduled-email";

export type ReminderWindow = 1440 | 60;
const titleKey = (w: ReminderWindow) => (w === 1440 ? "tw_reminder_title_24h" : "tw_reminder_title_1h");

/** TW-WF-1: reminder to the attendee, same body as the confirmation (with the add-to-calendar links), no .ics. */
export class AttendeeBookingReminderEmail extends AttendeeScheduledEmail {
  constructor(calEvent: CalendarEvent, attendee: Person, private readonly window: ReminderWindow) {
    super(calEvent, attendee, false);
    this.name = "SEND_BOOKING_REMINDER";
  }
  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    const payload = await super.getNodeMailerPayload();
    return { ...payload, icalEvent: undefined, subject: `${this.t(titleKey(this.window))}: ${this.calEvent.title}` };
  }
  async getHtml(calEvent: CalendarEvent, attendee: Person) {
    return await renderEmail("AttendeeScheduledEmail", {
      calEvent,
      attendee,
      title: titleKey(this.window),
      subject: titleKey(this.window),
    });
  }
}

/** TW-WF-1: reminder to a host (organizer or co-host). */
export class HostBookingReminderEmail extends OrganizerScheduledEmail {
  constructor(input: { calEvent: CalendarEvent; teamMember?: Person; window: ReminderWindow }) {
    super({ calEvent: input.calEvent, teamMember: input.teamMember });
    this.name = "SEND_BOOKING_REMINDER";
    this.window = input.window;
  }
  private window: ReminderWindow;
  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    const payload = await super.getNodeMailerPayload();
    return { ...payload, icalEvent: undefined, subject: `${this.t(titleKey(this.window))}: ${this.calEvent.title}` };
  }
  async getHtml(calEvent: CalendarEvent, attendee: Person, teamMember?: Person) {
    return await renderEmail("OrganizerScheduledEmail", {
      calEvent,
      attendee,
      teamMember,
      title: titleKey(this.window),
      subject: titleKey(this.window),
    });
  }
}
