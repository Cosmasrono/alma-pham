"use client";

// The visit's journey: each stage with its arrival time and how long it took
// until the next one. Visits from before timing existed render nothing.

import { useState } from "react";
import type { Visit, VisitStatus } from "@/lib/types";
import { formatDuration } from "@/lib/selectors";

export const STAGE_LABELS: Record<VisitStatus, string> = {
  "awaiting-triage": "Reception",
  "awaiting-consult-payment": "Consultation payment",
  waiting: "Sent to doctor",
  "with-doctor": "Consultation",
  "awaiting-lab-payment": "Lab payment",
  "awaiting-services": "Services",
  "back-to-doctor": "Back to doctor",
  "awaiting-pharmacy": "Pharmacy",
  completed: "Completed",
};

const at = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
  });

export function VisitTimeline({ visit }: { visit: Visit }) {
  // Snapshot "now" once per mount — durations refresh with the data anyway.
  const [nowMs] = useState(() => Date.now());
  const timeline = visit.timeline ?? [];
  if (timeline.length === 0) return null;
  return (
    <ol className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1.5 text-xs text-zinc-500 dark:text-zinc-400">
      {timeline.map((e, i) => {
        const next = timeline[i + 1];
        const spentMs =
          (next ? new Date(next.at).getTime() : nowMs) -
          new Date(e.at).getTime();
        const last = i === timeline.length - 1;
        const open = last && e.status !== "completed";
        return (
          <li key={i} className="flex items-center gap-1">
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {STAGE_LABELS[e.status]} {at(e.at)}
              {(next || open) && e.status !== "completed" && (
                <span className="ml-1 font-normal text-zinc-400 dark:text-zinc-500">
                  · {formatDuration(spentMs)}
                </span>
              )}
            </span>
            {!last && <span aria-hidden>→</span>}
          </li>
        );
      })}
    </ol>
  );
}
