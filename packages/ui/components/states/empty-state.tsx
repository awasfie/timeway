// Ported 1:1 from awasfie/salesos packages/ui/src/states/empty-state.tsx @ 722e786ea5 (WC-DX-14a 3a68820 #236 + 14a2 d720520 #250)
// for WC-DX-14c2. Timeway token roles (packages/config/theme/tokens.css + brand-timeway.css) replace the @salesos/ui roles.
import * as React from "react";
import { ClearedIllustration, FirstUseIllustration, NoResultsIllustration } from "./illustrations";

const cn = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(" ");

export type EmptyVariant = "first-use" | "no-results" | "cleared";

export interface EmptyStateProps {
  variant: EmptyVariant;
  title: React.ReactNode;
  body: React.ReactNode;
  /** Primary next step. No dead ends: first-use and no-results should always pass one (WIG). */
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  /** Override the variant illustration; pass `null` to hide it. */
  illustration?: React.ReactNode;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

const defaults: Record<EmptyVariant, React.ReactNode> = {
  "first-use": <FirstUseIllustration />,
  "no-results": <NoResultsIllustration />,
  cleared: <ClearedIllustration />,
};

/**
 * WC-DX-14 step 1 (CC-55 items 6, 7, 9): the three empties. first-use = nothing created yet; no-results = a
 * filter or search emptied a non-empty list; cleared = the user finished everything (success feedback, polite
 * live region so the change is announced). Emblem + sentence + action (UX.0.4).
 */
export function EmptyState({
  variant,
  title,
  body,
  action,
  secondaryAction,
  illustration,
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const H = `h${headingLevel}` as "h2";
  const art = illustration === undefined ? defaults[variant] : illustration;
  const headingId = React.useId();
  return (
    <section
      aria-labelledby={headingId}
      data-state={variant}
      role={variant === "cleared" ? "status" : undefined}
      className={cn(
        "mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-12 text-center text-subtle",
        className
      )}>
      {art ? <div className="text-subtle">{art}</div> : null}
      <H id={headingId} className="font-semibold text-emphasis text-lg [text-wrap:balance]">
        {title}
      </H>
      <p className="max-w-[60ch] text-sm text-subtle">{body}</p>
      {action || secondaryAction ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </section>
  );
}

export type ListKind = "default" | "sparse" | "dense";
const ListKindContext = React.createContext<ListKind>("default");

/** Row heights: default 48 px, dense 32 px (CC-55 item 3: 4 px internals allowed on 32/40 px rows). */
export const rowHeight: Record<ListKind, string> = {
  default: "min-h-12 py-2",
  sparse: "min-h-12 py-2",
  dense: "min-h-8 py-1",
};

export interface ListStateProps {
  kind: ListKind;
  children: React.ReactNode;
  /** sparse only: the next-step hint row shown after the 1-3 real rows. */
  hint?: React.ReactNode;
  hintAction?: React.ReactNode;
  "aria-label"?: string;
  className?: string;
}

/**
 * WC-DX-14 (CC-55 item 7): sparse and dense are list layouts, not empties. sparse (1-3 rows) appends a next-step
 * hint row so a near-empty list never reads as finished; dense switches every `ListRow` to the 32 px compact row.
 */
export function ListState({ kind, children, hint, hintAction, className, ...aria }: ListStateProps) {
  return (
    <ListKindContext.Provider value={kind}>
      <ul
        data-list={kind}
        className={cn("divide-y divide-subtle rounded-md border border-subtle bg-default", className)}
        {...aria}>
        {children}
        {kind === "sparse" && hint ? (
          <li
            data-row="hint"
            className="flex min-h-12 flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-subtle">
            <span className="min-w-0">{hint}</span>
            {hintAction}
          </li>
        ) : null}
      </ul>
    </ListKindContext.Provider>
  );
}

export interface ListRowProps extends React.LiHTMLAttributes<HTMLLIElement> {
  /** Columns in the row grid; keep equal to the `ListSkeleton` columns so loading mirrors the list. */
  columns?: number;
}

export function ListRow({ columns = 3, className, style, ...props }: ListRowProps) {
  const kind = React.useContext(ListKindContext);
  return (
    <li
      data-row={kind}
      className={cn(
        "grid items-center gap-3 px-4 text-emphasis text-sm",
        kind === "dense" ? "text-[0.8125rem]" : undefined,
        rowHeight[kind],
        className
      )}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, ...style }}
      {...props}
    />
  );
}
