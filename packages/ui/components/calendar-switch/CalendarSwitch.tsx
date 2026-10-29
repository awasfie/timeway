"use client";

import classNames from "@calcom/ui/classNames";
import { ArrowLeftIcon, RotateCwIcon } from "@coss/ui/icons";
import type { ReactNode } from "react";

export type ICalendarSwitchProps = {
  title: string;
  externalId: string;
  type: string;
  isChecked: boolean;
  name: string;
  isLastItemInList?: boolean;
  destination?: boolean;
  credentialId: number;
  delegationCredentialId: string | null;
  eventTypeId: number | null;
  disabled?: boolean;
};

export function CalendarSwitchComponent(
  props: ICalendarSwitchProps & {
    isLoading: boolean;
    children: ReactNode;
    translations?: {
      spanText?: string;
    };
  }
) {
  const {
    externalId,
    name,
    isLoading,
    translations = {
      spanText: "Adding events to",
    },
    children,
  } = props;

  return (
    <div className={classNames("my-2 flex flex-row items-center")}>
      <div className="flex ps-2">{children}</div>
      <label className="ms-3 text-sm font-medium leading-5" htmlFor={externalId}>
        {name}
      </label>
      {!!props.destination && (
        <span className="bg-subtle text-default ms-8 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-normal sm:ms-4">
          <ArrowLeftIcon className="h-4 w-4" />
          {translations.spanText}
        </span>
      )}
      {isLoading && <RotateCwIcon className="text-muted h-4 w-4 animate-spin ms-1" />}
    </div>
  );
}
