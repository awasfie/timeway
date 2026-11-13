"use client";

import { type NextPage } from "next";
import dynamic from "next/dynamic";
import { useEffect } from "react";

import type { ErrorProps } from "./errorBody";

// WC-TW-6n-3: lazy error UI, see error.tsx.
const CustomError = dynamic(() => import("./errorBody"));

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
