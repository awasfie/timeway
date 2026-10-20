// Ported 1:1 from awasfie/salesos packages/ui/src/states/errors.tsx @ 722e786ea5 (WC-DX-14a 3a68820 #236 + 14a2 d720520 #250)
// for WC-DX-14c2b. Timeway token roles (packages/config/theme/tokens.css + brand-timeway.css) replace the @salesos/ui roles.
// Timeway deltas: labels come from the caller (packages/i18n/locales/*/common.json via t()) instead of salesos
// states/copy.ts; Button `ghost`/`pending` map to Timeway `minimal`/`loading`.
import * as React from "react";
import { Button } from "../button";

const cn = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(" ");

/** Wiring for a field-level error: spread `inputProps` on the control and `errorProps` on `<FieldError>`. */
export function useFieldError(id: string, error?: string | null) {
  const errorId = `${id}-error`;
  return {
    invalid: Boolean(error),
    inputProps: {
      id,
      "aria-invalid": error ? (true as const) : undefined,
      "aria-describedby": error ? errorId : undefined,
    },
    errorProps: { id: errorId, children: error ?? null },
  };
}

export interface FieldErrorProps {
  id: string;
  children?: React.ReactNode;
  className?: string;
}

/**
 * WC-DX-14 step 3: field-level error rendered beside its control, referenced by the control's aria-describedby.
 * The wrapper is always mounted as a polite live region so a new message is announced (WIG feedback rule);
 * the icon is a redundant cue next to the text, never colour alone.
 */
export function FieldError({ id, children, className }: FieldErrorProps) {
  return (
    <p
      id={id}
      aria-live="polite"
      className={cn("text-error flex min-h-5 items-start gap-1 text-sm", className)}>
      {children ? (
        <>
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            className="mt-0.5 shrink-0">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.5v4.5M8 11.2v.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>{children}</span>
        </>
      ) : null}
    </p>
  );
}

/** 5xx codes. A 5xx error must carry the request id (type-level, WC-DX-14 step 3). */
export type ServerErrorStatus = 500 | 501 | 502 | 503 | 504 | 505 | 506 | 507 | 508 | 510 | 511;
/** Non-5xx: 0 = network/offline, 4xx = client errors. */
export type OtherErrorStatus = 0 | 400 | 401 | 403 | 404 | 408 | 409 | 410 | 413 | 422 | 423 | 429;

export const isServerErrorStatus = (s: unknown): s is ServerErrorStatus =>
  typeof s === "number" && s >= 500 && s <= 511 && s !== 509;

export interface PageErrorLabels {
  retry: string;
  requestId: string;
  copy: string;
  copied: string;
}

interface PageErrorBase {
  /** What happened, in one sentence. */
  what: React.ReactNode;
  /** What to do next. */
  do: React.ReactNode;
  onRetry: () => void;
  /** Retry / Request ID / Copy / Copied, already translated. */
  labels: PageErrorLabels;
  retryPending?: boolean;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

export type PageErrorProps = PageErrorBase &
  ({ status: ServerErrorStatus; requestId: string } | { status?: OtherErrorStatus; requestId?: string });

/**
 * WC-DX-14 step 3 (CC-55 item 8): page-level error in three parts: what happened, what to do, Retry. When a
 * request id is present it is shown isolated (`<bdi translate="no">`, safe in RTL and from auto-translate)
 * with a copy button.
 */
export function PageError({
  what,
  do: next,
  onRetry,
  requestId,
  status,
  labels,
  retryPending,
  headingLevel = 2,
  className,
}: PageErrorProps) {
  const H = `h${headingLevel}` as "h2";
  const [copied, setCopied] = React.useState(false);
  const idRef = React.useRef<HTMLElement>(null);

  const copy = async () => {
    if (!requestId) return;
    try {
      await navigator.clipboard.writeText(requestId);
      setCopied(true);
    } catch {
      // Clipboard API refused (permissions, insecure origin): select the id so the user can copy it.
      const el = idRef.current;
      const sel = window.getSelection();
      if (el && sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  };

  return (
    <section
      role="alert"
      data-state="error"
      data-status={status}
      className={cn("mx-auto flex max-w-md flex-col gap-3 px-4 py-12", className)}>
      <H className="text-emphasis text-lg font-semibold">{what}</H>
      <p className="text-subtle text-sm">{next}</p>
      {requestId ? (
        <p className="text-subtle flex flex-wrap items-center gap-2 text-sm">
          <span>{labels.requestId}:</span>
          <bdi translate="no" ref={idRef} className="bg-subtle text-emphasis rounded-sm px-1 font-mono">
            {requestId}
          </bdi>
          <Button color="minimal" size="sm" onClick={copy}>
            {labels.copy}
          </Button>
          <span aria-live="polite" className="text-success">
            {copied ? labels.copied : ""}
          </span>
        </p>
      ) : null}
      <div>
        <Button onClick={onRetry} loading={retryPending}>
          {labels.retry}
        </Button>
      </div>
    </section>
  );
}
