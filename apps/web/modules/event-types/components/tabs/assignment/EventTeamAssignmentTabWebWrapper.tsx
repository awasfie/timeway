"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { EventTypeSetupProps, FormValues } from "@calcom/features/eventtypes/lib/types";
import { SchedulingType } from "@calcom/prisma/enums";
import { Controller, useFormContext } from "react-hook-form";

type Props = Pick<EventTypeSetupProps, "teamMembers" | "team" | "eventType"> & { orgId?: number | null };

/**
 * TW-HOST-1: minimal Assignment panel restored after the Cal.diy refactor deleted it.
 * Lists every accepted team member with a "Fixed host" toggle. Fixed hosts are on every
 * booking (collective) and the first fixed host (highest priority) is the organizer.
 */
export default function EventTeamAssignmentTab({ teamMembers, eventType }: Props) {
  const { t } = useLocale();
  const { control } = useFormContext<FormValues>();
  const label =
    eventType.schedulingType === SchedulingType.COLLECTIVE
      ? "Collective: every assigned host attends every booking"
      : eventType.schedulingType === SchedulingType.ROUND_ROBIN
        ? "Round robin"
        : "Managed";

  return (
    <div className="flex flex-col gap-4" data-testid="assignment-panel">
      <div>
        <h3 className="text-emphasis text-base font-semibold">{t("assignment")}</h3>
        <p className="text-subtle text-sm" data-testid="assignment-scheduling-type">
          {label}
        </p>
      </div>
      <Controller
        name="hosts"
        control={control}
        render={({ field: { value, onChange } }) => {
          const hosts = value ?? [];
          const byUser = new Map(hosts.map((h) => [h.userId, h]));
          return (
            <ul className="border-subtle divide-subtle divide-y rounded-md border" data-testid="assignment-hosts">
              {teamMembers.map((m, idx) => {
                const host = byUser.get(m.id);
                const checked = !!host;
                return (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-2" data-testid={`host-row-${m.id}`}>
                    <input
                      type="checkbox"
                      aria-label={`host-${m.id}`}
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          onChange([
                            ...hosts,
                            {
                              isFixed: true,
                              userId: m.id,
                              priority: Math.max(1, 4 - idx),
                              weight: 100,
                              scheduleId: null,
                              groupId: null,
                            },
                          ]);
                        } else {
                          onChange(hosts.filter((h) => h.userId !== m.id));
                        }
                      }}
                    />
                    <span className="text-emphasis text-sm font-medium">{m.name ?? m.email}</span>
                    <span className="text-subtle text-sm">{m.email}</span>
                    {host ? (
                      <span className="text-subtle ms-auto text-xs">
                        {host.isFixed ? "Fixed host" : "Round-robin host"} · priority {host.priority}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          );
        }}
      />
    </div>
  );
}
