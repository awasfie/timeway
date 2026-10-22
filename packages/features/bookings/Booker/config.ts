import { useEffect, useRef } from "react";

import { BookerLayouts } from "@calcom/prisma/zod-utils";

import type { BookerLayout, BookerState } from "./types";

// CSS enter animations (tw-animate-css) replacing the former framer-motion variants, so the booker
// ships no animation runtime. fill-mode-backwards keeps the hidden state during the delay;
// motion-reduce disables them for prefers-reduced-motion.
export const fadeInLeftClassName =
  "animate-in fade-in slide-in-from-end-5 duration-300 ease-in-out delay-100 fill-mode-backwards motion-reduce:animate-none";
export const fadeInUpClassName =
  "animate-in fade-in slide-in-from-bottom-5 duration-300 ease-in-out delay-300 fill-mode-backwards motion-reduce:animate-none";

type ResizeAnimationConfig = {
  [key in BookerLayout]: {
    [key in BookerState | "default"]?: React.CSSProperties;
  };
};

/**
 * This configuration is used to animate the grid container for the booker.
 * The object is structured as following:
 *
 * The root property of the object: is the name of the layout
 * (mobile, month_view, week_view, column_view)
 *
 * The values of these properties are objects that define the animation for each state of the booker.
 * The values are applied as inline styles on the booker grid; width transitions via CSS classes.
 */
export const resizeAnimationConfig: ResizeAnimationConfig = {
  mobile: {
    default: {
      width: "100%",
      minHeight: "0px",
      gridTemplateAreas: `
          "meta"
          "header"
          "main"
          "timeslots"
        `,
      gridTemplateColumns: "100%",
      gridTemplateRows: "minmax(min-content,max-content) 1fr",
    },
  },
  month_view: {
    default: {
      width: "calc(var(--booker-meta-width) + var(--booker-main-width))",
      minHeight: "450px",
      height: "auto",
      gridTemplateAreas: `
      "meta main main"
      "meta main main"
      `,
      gridTemplateColumns: "var(--booker-meta-width) var(--booker-main-width)",
      gridTemplateRows: "1fr 0fr",
    },
    selecting_time: {
      width: "calc(var(--booker-meta-width) + var(--booker-main-width) + var(--booker-timeslots-width))",
      minHeight: "450px",
      height: "auto",
      gridTemplateAreas: `
      "meta main timeslots"
      "meta main timeslots"
      `,
      gridTemplateColumns: "var(--booker-meta-width) 1fr var(--booker-timeslots-width)",
      gridTemplateRows: "1fr 0fr",
    },
  },
  week_view: {
    default: {
      width: "100vw",
      minHeight: "100vh",
      height: "auto",
      gridTemplateAreas: `
      "meta header header"
      "meta main main"
      `,
      gridTemplateColumns: "var(--booker-meta-width) 1fr",
      gridTemplateRows: "70px auto",
    },
  },
  column_view: {
    default: {
      width: "100vw",
      minHeight: "100vh",
      height: "auto",
      gridTemplateAreas: `
      "meta header header"
      "meta main main"
      `,
      gridTemplateColumns: "var(--booker-meta-width) 1fr",
      gridTemplateRows: "70px auto",
    },
  },
};

export const getBookerSizeClassNames = (
  layout: BookerLayout,
  bookerState: BookerState,
  hideEventTypeDetails = false
) => {
  const getBookerMetaClass = (className: string) => {
    if (hideEventTypeDetails) {
      return "";
    }
    return className;
  };

  return [
    // Size settings are abstracted on their own lines purely for readability.
    // General sizes, used always
    "[--booker-timeslots-width:240px] lg:[--booker-timeslots-width:280px]",
    // Small calendar defaults
    layout === BookerLayouts.MONTH_VIEW && getBookerMetaClass("[--booker-meta-width:240px]"),
    // Meta column gets wider in booking view to fit the full date on a single row in case
    // of a multi occurrence event. Also makes form less wide, which also looks better.
    layout === BookerLayouts.MONTH_VIEW &&
      bookerState === "booking" &&
      `[--booker-main-width:420px] ${getBookerMetaClass("lg:[--booker-meta-width:340px]")}`,
    // Smaller meta when not in booking view.
    layout === BookerLayouts.MONTH_VIEW &&
      bookerState !== "booking" &&
      `[--booker-main-width:480px] ${getBookerMetaClass("lg:[--booker-meta-width:280px]")}`,
    // Fullscreen view settings.
    layout !== BookerLayouts.MONTH_VIEW &&
      `[--booker-main-width:480px] [--booker-meta-width:340px] ${getBookerMetaClass(
        "lg:[--booker-meta-width:424px]"
      )}`,
  ];
};

/**
 * Returns a ref for the booker element and applies the grid layout of the current layout/state to it.
 * Width changes animate through the element's CSS transition classes (disabled for reduced motion);
 * height is set directly because CSS cannot transition to "auto".
 */
export const useBookerResizeAnimation = (layout: BookerLayout, state: BookerState) => {
  const animationScope = useRef<HTMLDivElement>(null);
  const isEmbed = typeof window !== "undefined" && window?.isEmbed?.();
  useEffect(() => {
    const animationConfig = resizeAnimationConfig[layout][state] || resizeAnimationConfig[layout].default;
    const element = animationScope.current;
    if (!element) return;

    const height = animationConfig?.height || "auto";
    // 100vh inside an iframe makes the embed grow forever; 100% follows the iframe instead.
    element.style.height = height === "100vh" && isEmbed ? "100%" : String(height);
    element.style.gridTemplateAreas = animationConfig?.gridTemplateAreas ?? "";
    element.style.width = String(animationConfig?.width || "auto");
    element.style.gridTemplateColumns = animationConfig?.gridTemplateColumns ?? "";
    element.style.gridTemplateRows = animationConfig?.gridTemplateRows ?? "";
    element.style.minHeight = String(animationConfig?.minHeight ?? "");
  }, [isEmbed, layout, state]);

  return animationScope;
};

/**
 * These configures the amount of days that are shown on top of the selected date.
 */
export const extraDaysConfig = {
  mobile: {
    // Desktop tablet feels weird on mobile layout,
    // but this is simply here to make the types a lot easier..
    desktop: 0,
    tablet: 0,
  },
  [BookerLayouts.MONTH_VIEW]: {
    desktop: 0,
    tablet: 0,
  },
  [BookerLayouts.WEEK_VIEW]: {
    desktop: 7,
    tablet: 4,
  },
  [BookerLayouts.COLUMN_VIEW]: {
    desktop: 6,
    tablet: 2,
  },
};
