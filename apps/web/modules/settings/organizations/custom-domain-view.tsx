"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Badge } from "@calcom/ui/components/badge";
import { Button } from "@calcom/ui/components/button";
import { TextField } from "@calcom/ui/components/form";
import { showToast } from "@calcom/ui/components/toast";
import { useEffect, useRef, useState } from "react";
import { POLL_INTERVAL_MS, POLL_WINDOW_MS } from "./custom-domain-polling";

const CHIP: Record<string, { variant: "orange" | "green" | "red"; key: string }> = {
  pending_dns: { variant: "orange", key: "custom_domain_status_pending_dns" },
  active: { variant: "green", key: "custom_domain_status_active" },
  failed: { variant: "red", key: "custom_domain_status_failed" },
};

export default function CustomDomainView({ orgId }: { orgId: string }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const query = trpc.viewer.organizations.customDomain.get.useQuery({ orgId });
  const [hostname, setHostname] = useState("");
  const [pollStartedAt, setPollStartedAt] = useState<number | null>(null);
  const [pollExpired, setPollExpired] = useState(false);

  const onError = (e: { message: string }) => showToast(e.message, "error");
  const setRow = (data: unknown) =>
    utils.viewer.organizations.customDomain.get.setData({ orgId }, data as never);

  const add = trpc.viewer.organizations.customDomain.add.useMutation({
    onSuccess: (data) => {
      setRow(data);
      setHostname("");
      startPolling();
    },
    onError,
  });
  const refresh = trpc.viewer.organizations.customDomain.refresh.useMutation({
    onSuccess: setRow,
    onError,
  });
  const remove = trpc.viewer.organizations.customDomain.remove.useMutation({
    onSuccess: () => {
      setRow({ hostname: null, cnameTarget: query.data?.cnameTarget });
      setPollStartedAt(null);
      setPollExpired(false);
    },
    onError,
  });

  const row = query.data?.hostname ?? null;
  const cnameTarget = query.data?.cnameTarget ?? "customers.timeway.co";
  const status = row?.status as string | undefined;

  function startPolling() {
    setPollExpired(false);
    setPollStartedAt(Date.now());
  }

  // Begin the window the first time a pending row is seen (page load or after add).
  useEffect(() => {
    if (status === "pending_dns" && pollStartedAt === null && !pollExpired) startPolling();
    if (status !== "pending_dns" && pollStartedAt !== null) setPollStartedAt(null);
  }, [status, pollStartedAt, pollExpired]);

  const refreshRef = useRef(refresh.mutate);
  refreshRef.current = refresh.mutate;
  useEffect(() => {
    if (pollStartedAt === null) return;
    const interval = setInterval(() => {
      if (Date.now() - pollStartedAt >= POLL_WINDOW_MS) {
        clearInterval(interval);
        setPollStartedAt(null);
        setPollExpired(true);
        return;
      }
      refreshRef.current({ orgId });
    }, POLL_INTERVAL_MS);
    const stop = setTimeout(() => {
      clearInterval(interval);
      setPollStartedAt(null);
      setPollExpired(true);
    }, POLL_WINDOW_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, [pollStartedAt, orgId]);

  if (query.isPending) return <div className="border-subtle rounded-b-xl border border-t-0 p-6">…</div>;

  const chip = status ? CHIP[status] : undefined;
  const showCheckAgain = !!row && status !== "active" && pollStartedAt === null;

  return (
    <div
      className="border-subtle rounded-b-xl border border-t-0 px-4 py-6 sm:px-6"
      data-testid="custom-domain">
      <p className="text-subtle mb-4 text-sm">{t("custom_domain_subdomain_only")}</p>

      {!row ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate({ orgId, hostname: hostname.trim() });
          }}>
          <div className="flex-1">
            <TextField
              name="hostname"
              data-testid="custom-domain-input"
              label={t("custom_domain_hostname")}
              placeholder="book.example.com"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            data-testid="custom-domain-add"
            loading={add.isPending}
            disabled={!hostname.trim()}>
            {t("custom_domain_add")}
          </Button>
        </form>
      ) : (
        <div className="stack-y-4">
          <div className="flex items-center gap-3">
            <span className="text-emphasis font-medium" data-testid="custom-domain-hostname" dir="ltr">
              {row.hostname}
            </span>
            {chip && (
              <Badge variant={chip.variant} data-testid="custom-domain-status">
                {t(chip.key)}
              </Badge>
            )}
          </div>

          {status !== "active" && (
            <>
              <p className="text-default text-sm">{t("custom_domain_instruction")}</p>
              <code
                className="bg-subtle block rounded-md p-3 text-sm"
                dir="ltr"
                data-testid="custom-domain-cname">
                {row.hostname} CNAME {cnameTarget}
              </code>
              <p className="text-subtle text-sm">{t("custom_domain_pending_removed_48h")}</p>
            </>
          )}

          {status === "failed" && row.lastError && (
            <p className="text-error text-sm" data-testid="custom-domain-error">
              {t("custom_domain_error")}: {row.lastError}
            </p>
          )}
          {status === "pending_dns" && pollStartedAt !== null && (
            <p className="text-subtle text-sm" data-testid="custom-domain-polling">
              {t("custom_domain_polling")}
            </p>
          )}

          <div className="flex gap-2">
            {showCheckAgain && (
              <Button
                color="secondary"
                data-testid="custom-domain-check-again"
                loading={refresh.isPending}
                onClick={() => {
                  refresh.mutate({ orgId });
                  if (status === "pending_dns") startPolling();
                }}>
                {t("custom_domain_check_again")}
              </Button>
            )}
            <Button
              color="destructive"
              data-testid="custom-domain-remove"
              loading={remove.isPending}
              onClick={() => remove.mutate({ orgId })}>
              {t("custom_domain_remove")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
