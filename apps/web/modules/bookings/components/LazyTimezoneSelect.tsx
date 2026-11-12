"use client";

import type { Timezone } from "@calcom/features/bookings/Booker/types";
import type { TimezoneSelectComponentProps } from "@calcom/features/timezone/components/TimezoneSelectComponent";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { getTimezoneLabel } from "@calcom/lib/timezoneLabel";
import { Icon } from "@calcom/ui/components/icon";
import type { ComponentType } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type TimezoneSelectProps = Omit<
  TimezoneSelectComponentProps,
  "data" | "isPending" | "isWebTimezoneSelect"
> & {
  timeZones?: Timezone[];
};
type Loader = () => Promise<ComponentType<TimezoneSelectProps>>;

// A plain import() behind user intent (not next/dynamic, which preloads with the page) keeps the
// picker chunk — react-select, emotion, spacetime, timezone-soft — off the booking first load.
function cachedLoader(load: Loader) {
  let loaded: ComponentType<TimezoneSelectProps> | null = null;
  let pending: Promise<ComponentType<TimezoneSelectProps>> | null = null;
  return {
    get: () => loaded,
    load: () => {
      if (loaded) return Promise.resolve(loaded);
      pending ??= load().then(
        (C) => {
          loaded = C;
          return C;
        },
        (err) => {
          pending = null;
          throw err;
        }
      );
      return pending;
    },
  };
}

const webLoader = cachedLoader(() =>
  import("@calcom/web/modules/timezone/components/TimezoneSelect").then(
    (mod) => mod.TimezoneSelect as ComponentType<TimezoneSelectProps>
  )
);
const platformLoader = cachedLoader(() => import("@calcom/atoms/timezone").then((mod) => mod.Timezone));

export function LazyTimezoneSelect({
  value,
  isDisabled,
  isPlatform = false,
  ...props
}: TimezoneSelectProps & { value: string; isPlatform?: boolean }) {
  const loader = isPlatform ? platformLoader : webLoader;
  const { t } = useLocale();
  const [Select, setSelect] = useState<ComponentType<TimezoneSelectProps> | null>(() => loader.get());
  const [openOnMount, setOpenOnMount] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const prefetch = useCallback(() => {
    if (isDisabled) return;
    loader.load().catch(() => undefined);
  }, [isDisabled, loader]);

  const activate = useCallback(() => {
    if (isDisabled) return;
    setOpenOnMount(true);
    loader
      .load()
      .then((Loaded) => {
        if (mounted.current) setSelect(() => Loaded);
      })
      .catch(() => setOpenOnMount(false));
  }, [isDisabled, loader]);

  if (Select) {
    return (
      <Select
        {...props}
        value={value}
        isDisabled={isDisabled}
        autoFocus={openOnMount || props.autoFocus}
        defaultMenuIsOpen={openOnMount || props.defaultMenuIsOpen}
      />
    );
  }

  // `relative` lifts the trigger above the host's positioned ::before hover overlay (EventMeta),
  // which otherwise swallows the click; react-select's container was positioned the same way.
  return (
    <button
      type="button"
      data-testid="timezone-select-trigger"
      aria-label={t("timezone")}
      aria-haspopup="listbox"
      disabled={isDisabled}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      className="relative flex w-full min-w-0 items-center justify-between gap-1 bg-transparent py-1 text-start text-text disabled:cursor-not-allowed">
      <span className="truncate">{getTimezoneLabel(value)}</span>
      {!isDisabled && <Icon name="chevron-down" className="ms-auto h-4 w-4 shrink-0 text-default" />}
    </button>
  );
}
