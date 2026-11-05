import { useRef, useEffect } from "react";
import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import type { EventLocationType } from "@calcom/app-store/locations";
import { useBookerStore } from "@calcom/features/bookings/Booker/store";
import type getBookingResponsesSchema from "@calcom/features/bookings/lib/getBookingResponsesSchema";
import type { BookerEvent } from "@calcom/features/bookings/types";
import { useLocale } from "@calcom/lib/hooks/useLocale";

import { useInitialFormValues } from "./useInitialFormValues";

export interface IUseBookingForm {
  event?: Pick<BookerEvent, "bookingFields" | "team" | "owner"> | null;
  sessionEmail?: string | null;
  sessionName?: string | null;
  sessionUsername?: string | null;
  hasSession: boolean;
  extraOptions: Record<string, string | string[]>;
  prefillFormParams: {
    guests: string[];
    name: string | null;
  };
  clientId?: string;
}

export type UseBookingFormReturnType = ReturnType<typeof useBookingForm>;

export const useBookingForm = ({
  event,
  sessionEmail,
  sessionName,
  sessionUsername,
  hasSession,
  extraOptions,
  prefillFormParams,
  clientId,
}: IUseBookingForm) => {
  const rescheduleUid = useBookerStore((state) => state.rescheduleUid);
  const bookingData = useBookerStore((state) => state.bookingData);
  const { t } = useLocale();
  const bookerFormErrorRef = useRef<HTMLDivElement>(null);

  type BookingFormValues = {
    locationType?: EventLocationType["type"];
    responses: z.infer<ReturnType<typeof getBookingResponsesSchema>> | null;
    // Key is not really part of form values, but only used to have a key
    // to set generic error messages on. Needed until RHF has implemented root error keys.
    globalError: undefined;
    cfToken?: string;
  };
  const isRescheduling = !!rescheduleUid && !!bookingData;

  const { values: initialValues, key } = useInitialFormValues({
    eventType: event,
    rescheduleUid,
    isRescheduling,
    email: sessionEmail,
    name: sessionName,
    username: sessionUsername,
    hasSession,
    extraOptions,
    prefillFormParams,
    clientId,
  });

  // The zod schema and resolver load on first validation (submit), not with the booker (WC-TW-6n-4a).
  const bookingFields = event?.bookingFields;
  const view = rescheduleUid ? "reschedule" : "booking";
  const resolver: Resolver<BookingFormValues> = async (values, context, options) => {
    const { getBookingFormResolver } = await import("../lib/bookingFormValidation");
    const zodBookingResolver = getBookingFormResolver({
      bookingFields,
      view,
      translateFn: (key: string, opts?: Record<string, unknown>) => t(key, opts ?? {}),
    }) as unknown as Resolver<BookingFormValues>;
    return zodBookingResolver(values, context, options);
  };

  const bookingForm = useForm<BookingFormValues>({
    defaultValues: initialValues,
    resolver,
  });

  useEffect(() => {
    // initialValues would be null initially as the async schema parsing is happening. Let's show the form in first render without any prefill values
    // But ensure that when initialValues is available, the form is reset and rerendered with the prefill values
    bookingForm.reset(initialValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const email = bookingForm.watch("responses.email");
  const name = bookingForm.watch("responses.name");

  const beforeVerifyEmail = () => {
    bookingForm.clearErrors();

    // It shouldn't be possible that this method is fired without having event data,
    // but since in theory (looking at the types) it is possible, we still handle that case.
    if (!event) {
      bookingForm.setError("globalError", { message: t("error_booking_event") });
      return;
    }
  };

  const errors = {
    hasFormErrors: Boolean(bookingForm.formState.errors["globalError"]),
    formErrors: bookingForm.formState.errors["globalError"],
  };

  return {
    bookingForm,
    bookerFormErrorRef,
    key,
    formEmail: email,
    formName: name,
    beforeVerifyEmail,
    formErrors: errors,
    errors,
  };
};
