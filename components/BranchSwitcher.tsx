"use client";

// Which clinic branch the screens are showing. Admins can switch between
// branches (or see all at once); everyone else sees the branch they work at.

import { useState } from "react";
import { switchBranch, useClinic } from "@/lib/store";
import { cn } from "./ui";
import { BRANCHES_ENABLED } from "@/lib/features";

export function BranchSwitcher({ className }: { className?: string }) {
  const data = useClinic();
  const [busy, setBusy] = useState(false);
  const active = data.branches.filter((b) => b.active);

  // Hidden while branches are switched off, until the first load, or while
  // there is only one open branch — a single-site clinic never sees this.
  if (!BRANCHES_ENABLED || active.length < 2) return null;

  const current = data.branches.find((b) => b.id === data.viewBranchId);

  if (!data.canSwitchBranch) {
    return (
      <div className={cn("rounded-xl bg-white/5 px-3 py-2 text-xs text-teal-100", className)}>
        <span className="text-teal-300/80">Branch</span>
        <p className="font-semibold text-white">{current?.name ?? "—"}</p>
      </div>
    );
  }

  return (
    <label className={cn("block rounded-xl bg-white/5 px-3 py-2 text-xs text-teal-100", className)}>
      <span className="text-teal-300/80">Viewing branch</span>
      <select
        className="mt-1 w-full rounded-lg border border-white/15 bg-teal-950 px-2 py-1.5 text-sm font-semibold text-white"
        value={data.viewBranchId ?? "all"}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          await switchBranch(e.target.value);
          setBusy(false);
        }}
      >
        <option value="all">All branches</option>
        {active.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
            {b.isMain ? " (main)" : ""}
          </option>
        ))}
      </select>
      {busy && <span className="mt-1 block text-[11px] text-teal-300">Loading branch…</span>}
    </label>
  );
}
