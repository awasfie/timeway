"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import { Delayed, EmptyState, ListSkeleton } from "@calcom/ui/components/states";
import type { Table as ReactTable } from "@tanstack/react-table";
import { DataTableWrapper } from "~/data-table/components";
import type { BookingListingStatus, RowData } from "../types";

const descriptionByStatus: Record<BookingListingStatus, string> = {
  upcoming: "upcoming_bookings",
  recurring: "recurring_bookings",
  past: "past_bookings",
  cancelled: "cancelled_bookings",
  unconfirmed: "unconfirmed_bookings",
};

type BookingListViewProps = {
  status: BookingListingStatus;
  table: ReactTable<RowData>;
  isPending: boolean;
  totalRowCount?: number;
  ErrorView?: React.ReactNode;
  hasError?: boolean;
  /** A filter or search is active: an empty result is no-results (with Clear filters), not first-use. */
  isFiltered?: boolean;
  onClearFilters?: () => void;
};

export function BookingList({
  status,
  table,
  isPending,
  totalRowCount,
  ErrorView,
  hasError,
  isFiltered,
  onClearFilters,
}: BookingListViewProps) {
  const { t } = useLocale();

  return (
    <DataTableWrapper
      className="mb-6"
      table={table}
      testId={`${status}-bookings`}
      bodyTestId="bookings"
      headerClassName="hidden"
      isPending={isPending}
      totalRowCount={totalRowCount}
      variant="compact"
      paginationMode="standard"
      separatorClassName="py-4 pl-6 text-xs uppercase leading-4"
      // WC-DX-14c2b: states library (salesos 722e786ea5 port). Skeleton only after 200 ms, held >= 400 ms.
      LoaderView={<Delayed loading fallback={<ListSkeleton rows={5} columns={3} label={t("loading")} />} />}
      EmptyView={
        <div data-testid="empty-screen" className="pt-2 xl:pt-0">
          {isFiltered ? (
            <EmptyState
              variant="no-results"
              title={t("no_results")}
              body={t("bookings_no_results_description")}
              action={
                onClearFilters ? (
                  <Button color="secondary" onClick={onClearFilters}>
                    {t("clear_filters")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              variant="first-use"
              title={t("no_status_bookings_yet", { status: t(status).toLowerCase() })}
              body={t("no_status_bookings_yet_description", {
                status: t(status).toLowerCase(),
                description: t(descriptionByStatus[status]),
              })}
            />
          )}
        </div>
      }
      ErrorView={ErrorView}
      hasError={hasError}
    />
  );
}
