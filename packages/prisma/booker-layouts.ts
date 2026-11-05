/**
 * zod-free constants shared by the public booker and the zod schemas in ./zod-utils.
 * The booker imports from here so @calcom/prisma/zod-utils (and zod) stay out of its
 * first-load bundle (WC-TW-6n-4a). ./zod-utils re-exports everything for existing callers.
 */

// Let's not import 118kb just to get an enum
export enum Frequency {
  YEARLY = 0,
  MONTHLY = 1,
  WEEKLY = 2,
  DAILY = 3,
  HOURLY = 4,
  MINUTELY = 5,
  SECONDLY = 6,
}

export enum BookerLayouts {
  MONTH_VIEW = "month_view",
  WEEK_VIEW = "week_view",
  COLUMN_VIEW = "column_view",
}

export const bookerLayoutOptions = [
  BookerLayouts.MONTH_VIEW,
  BookerLayouts.WEEK_VIEW,
  BookerLayouts.COLUMN_VIEW,
];

export const defaultBookerLayoutSettings = {
  defaultLayout: BookerLayouts.MONTH_VIEW,
  // if the user has no explicit layouts set (not in user profile and not in event settings), all layouts are enabled.
  enabledLayouts: bookerLayoutOptions,
};
