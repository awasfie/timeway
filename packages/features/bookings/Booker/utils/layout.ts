import { bookerLayoutOptions } from "@calcom/prisma/booker-layouts";

export const validateLayout = (layout?: "week_view" | "month_view" | "column_view" | null) => {
  return bookerLayoutOptions.find((validLayout) => validLayout === layout);
};
