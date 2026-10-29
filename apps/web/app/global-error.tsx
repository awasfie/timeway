"use client";

import { type NextPage } from "next";
import { useEffect } from "react";

import CustomError from "./error";
import type { ErrorProps } from "./error";

export const GlobalError: NextPage<ErrorProps> = (props) => {
  useEffect(() => {
    void import("@sentry/nextjs")
      .then(({ captureException }) => captureException(props.error))
      .catch(() => undefined);
  }, [props.error]);
  return (
    <html>
      <body>
        <CustomError {...props} />
      </body>
    </html>
  );
};

export default GlobalError;
