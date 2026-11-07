import type { ReactElement, Ref } from "react";
import React, { forwardRef } from "react";
import type { FieldValues, SubmitHandler, UseFormReturn } from "react-hook-form";
import { FormProvider } from "react-hook-form";

import { getErrorFromUnknown } from "@calcom/lib/errors";

// Toast code (sonner + its CSS) loads only when a submit fails, so it is not in the booking
// page's first-load JS (WC-TW-6n-2).
const showErrorToast = (message: string) =>
  void import("../../toast").then(({ showToast }) => showToast(message, "error")).catch(() => undefined);

type FormProps<T extends object> = { form: UseFormReturn<T>; handleSubmit: SubmitHandler<T> } & Omit<
  JSX.IntrinsicElements["form"],
  "onSubmit"
>;

const PlainForm = <T extends FieldValues>(props: FormProps<T>, ref: Ref<HTMLFormElement>) => {
  const { form, handleSubmit, ...passThrough } = props;

  return (
    <FormProvider {...form}>
      <form
        ref={ref}
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();

          form
            .handleSubmit(handleSubmit)(event)
            .catch((err) => {
              // FIXME: Booking Pages don't have toast, so this error is never shown
              showErrorToast(`${getErrorFromUnknown(err).message}`);
            });
        }}
        {...passThrough}>
        {props.children}
      </form>
    </FormProvider>
  );
};

export const Form = forwardRef(PlainForm) as <T extends FieldValues>(
  p: FormProps<T> & { ref?: Ref<HTMLFormElement> }
) => ReactElement;
