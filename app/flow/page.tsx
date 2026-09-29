"use client";

// Patient flow: the live board every staff member can open. Shows everyone
// currently in the clinic, where they are, and how long they've been in the
// process (reception check-in → now) — longest-staying patients first and
// highlighted, so hold-ups are impossible to miss.

import { useState } from "react";
import { useClinic } from "@/lib/store";
import {
  EmptyState,
  LocationBadge,
  PageHeader,
  PriorityBadge,
  StayBadge,
  cn,
} from "@/components/ui";
import { VisitTimeline } from "@/components/VisitTimeline";
import {
  LONG_STAY_MS,
  VERY_LONG_STAY_MS,
  clinicVisits,
  doctorMap,
  doctorName,
  formatDuration,
  patientMap,
  patientName,
  visitLocation,
  visitTiming,
} from "@/lib/selectors";

export default function FlowPage() {
  const data = useClinic();
  // Snapshot "now" once per mount — durations refresh with the data anyway.
  const [nowMs] = useState(() => Date.now());
  const pmap = patientMap(data);
  const dmap = doctorMap(data);

  const open = data.visits
    .filter((v) => v.status !== "completed")
    .map((v) => ({ visit: v, timing: visitTiming(v, nowMs) }))
    .sort((a, b) => b.timing.totalMs - a.timing.totalMs);

  const todayStr = new Date(nowMs).toDateString();
  // Patients who went through the clinic — counter sales never entered it.
  const completedToday = clinicVisits(data)
    .filter(
      (v) =>
        v.status === "completed" &&
        new Date(v.updatedAt).toDateString() === todayStr,
    )
    .map((v) => ({ visit: v, timing: visitTiming(v, nowMs) }))
    .sort((a, b) => b.timing.totalMs - a.timing.totalMs);

  const longest = open[0];

  return (
    <div>
      <PageHeader
        title="Patient flow"
        subtitle="Everyone in the clinic right now, longest-staying first — from check-in to completion"
      />

      {open.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 font-medium text-zinc-600">
            {open.length} in clinic
          </span>
          {longest && (
            <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 font-medium text-zinc-600">
              longest stay {formatDuration(longest.timing.totalMs)}
            </span>
          )}
        </div>
      )}

      {open.length === 0 ? (
        <EmptyState>Nobody is in the clinic right now.</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {open.map(({ visit, timing }) => {
            const patient = pmap.get(visit.patientId);
            const doctor = visit.assignedDoctorId
              ? dmap.get(visit.assignedDoctorId)
              : undefined;
            // The whole card takes the stay colour, so long-stayers pop.
            const tone =
              timing.totalMs >= VERY_LONG_STAY_MS
                ? "border-red-200 bg-red-50/60"
                : timing.totalMs >= LONG_STAY_MS
                  ? "border-amber-200 bg-amber-50/60"
                  : "border-teal-950/[0.07] bg-white";
            return (
              <div
                key={visit.id}
                className={cn(
                  "rounded-2xl border p-4 shadow-[0_1px_2px_rgb(4_47_43/0.04),0_12px_32px_-16px_rgb(4_47_43/0.16)]",
                  tone,
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-800">
                    {patientName(patient)}
                  </span>
                  <span className="font-mono text-xs text-zinc-500">
                    {patient?.mrn ?? ""}
                  </span>
                  <LocationBadge location={visitLocation(data, visit)} />
                  {visit.priority && (
                    <PriorityBadge priority={visit.priority} />
                  )}
                  <StayBadge timing={timing} />
                  <span className="ml-auto text-xs text-zinc-500">
                    {doctorName(doctor)}
                  </span>
                </div>
                <VisitTimeline visit={visit} />
              </div>
            );
          })}
        </div>
      )}

      {completedToday.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-sm font-semibold text-zinc-700">
            Completed today ({completedToday.length})
          </h2>
          <div className="overflow-hidden rounded-2xl border border-teal-950/[0.07] bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Patient</th>
                    <th className="px-4 py-2.5 font-medium">Doctor</th>
                    <th className="px-4 py-2.5 font-medium">
                      Total time in clinic
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {completedToday.map(({ visit, timing }) => {
                    const patient = pmap.get(visit.patientId);
                    const doctor = visit.assignedDoctorId
                      ? dmap.get(visit.assignedDoctorId)
                      : undefined;
                    return (
                      <tr key={visit.id} className="border-t border-zinc-100">
                        <td className="px-4 py-2.5">
                          <span className="font-medium text-zinc-800">
                            {patientName(patient)}
                          </span>{" "}
                          <span className="font-mono text-xs text-zinc-500">
                            {patient?.mrn ?? ""}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-zinc-600">
                          {doctorName(doctor)}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-zinc-600">
                          {formatDuration(timing.totalMs)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
