// Ported 1:1 from awasfie/salesos packages/ui/src/states/skeleton.tsx @ 722e786ea5 (WC-DX-14a 3a68820 #236 + 14a2 d720520 #250)
// for WC-DX-14c2b. Timeway token roles (packages/config/theme/tokens.css + brand-timeway.css) replace the @salesos/ui roles.
import type * as React from "react";
import { type ListKind, rowHeight } from "./empty-state";
import { type DelayedVisibleOptions, useDelayedVisible } from "./use-delayed-visible";

const cn = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(" ");

export type SkeletonShape = "line" | "block" | "row";

export interface SkeletonProps extends React.HTMLAttributes<HTMLSpanElement> {
  shape?: SkeletonShape;
}

const shapes: Record<SkeletonShape, string> = {
  line: "h-3 w-full rounded-sm",
  block: "h-24 w-full rounded-md",
  row: "h-8 w-full rounded-md",
};

/** WC-DX-14 step 2: decorative placeholder. Opacity pulse only, off under reduced motion; hidden from AT. */
export function Skeleton({ shape = "line", className, ...props }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      data-skeleton={shape}
      className={cn("bg-emphasis block motion-safe:animate-pulse", shapes[shape], className)}
      {...props}
    />
  );
}

export interface ListSkeletonProps {
  rows?: number;
  /** Must equal the final `ListRow` columns so the skeleton mirrors the list grid (no layout shift). */
  columns?: number;
  kind?: ListKind;
  /** Announced once to screen readers ("Loading…"). */
  label: string;
  className?: string;
}

/** Skeleton list with the same border, row height and grid as `ListState` + `ListRow`. */
export function ListSkeleton({
  rows = 5,
  columns = 3,
  kind = "default",
  label,
  className,
}: ListSkeletonProps) {
  return (
    <div role="status" aria-busy="true" data-list-skeleton={kind} className={className}>
      <span className="sr-only">{label}</span>
      <ul aria-hidden="true" className="divide-subtle border-subtle bg-default divide-y rounded-md border">
        {Array.from({ length: rows }, (_, r) => (
          <li
            key={r}
            className={cn("grid items-center gap-3 px-4", rowHeight[kind])}
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }, (_, c) => (
              <Skeleton key={c} className={c === 0 ? "w-3/4" : c === columns - 1 ? "w-1/3" : "w-1/2"} />
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface DelayedProps extends DelayedVisibleOptions {
  loading: boolean;
  /** Rendered only once the show-delay has passed (and for at least minVisible). */
  fallback: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * `useDelayedVisible` as a wrapper: before the delay nothing renders (fast loads never flash a skeleton),
 * then the fallback, then children once loading ends and minVisible has elapsed.
 */
export function Delayed({ loading, fallback, children, delay = 200, minVisible = 400 }: DelayedProps) {
  const show = useDelayedVisible(loading, { delay, minVisible });
  if (show) return <>{fallback}</>;
  if (loading) return null;
  return <>{children}</>;
}
