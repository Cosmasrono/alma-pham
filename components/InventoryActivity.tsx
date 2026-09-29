"use client";

// Dashboard section: inventory security and what each branch's stock did in
// the selected period. Every change is in the audit trail; changes worth a
// second look (manual decreases, big corrections, write-offs, price cuts,
// selling below cost) are flagged in red at the top.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useClinic } from "@/lib/store";
import { ChartCard, ColumnChart, SERIES_COLORS, type ChartPoint } from "@/components/charts";
import { cn } from "@/components/ui";
import type { Range } from "@/lib/analytics";
import { BRANCHES_ENABLED } from "@/lib/features";
import {
  EventBadge,
  fetchInventoryLog,
  signedUnits,
  when,
  type InventoryLog,
} from "@/components/InventoryEvents";

// What the branch chart compares, in units moved.
const MOVES = [
  { key: "sold", label: "Sold", types: ["sale"], color: SERIES_COLORS[0] },
  { key: "received", label: "Received", types: ["receive", "import", "opening"], color: SERIES_COLORS[2] },
  { key: "transferred", label: "Transferred", types: ["transfer-in", "transfer-out"], color: SERIES_COLORS[5] },
  { key: "adjusted", label: "Manual counts", types: ["adjust"], color: SERIES_COLORS[3] },
  { key: "written", label: "Written off", types: ["write-off"], color: SERIES_COLORS[1] },
] as const;

export function InventoryActivity({ range }: { range: Range }) {
  const data = useClinic();
  const [log, setLog] = useState<{ key: string; data: InventoryLog } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  const key = `${range.from}-${range.to}-${reloads}-${data.viewBranchId}`;
  useEffect(() => {
    let cancelled = false;
    fetchInventoryLog({
      // "All time" starts at 0, which the API would read as "default window".
      from: range.from || 1,
      to: range.to,
      branch: data.viewBranchId ?? "all",
      limit: 60,
    })
      .then((d) => {
        if (cancelled) return;
        setLog({ key, data: d });
        setError(null);
      })
      .catch(() => !cancelled && setError("Could not load the inventory log."));
    return () => {
      cancelled = true;
    };
  }, [key, range.from, range.to, data.viewBranchId]);

  const current = log?.key === key ? log.data : null;
  const branchName = useMemo(() => {
    const names = new Map(data.branches.map((b) => [b.id, b.name]));
    return (id: string | null) => (id ? (names.get(id) ?? "Removed branch") : "—");
  }, [data.branches]);
  // With branches hidden, drop the "· Main branch" noise from every line.
  const where = (id: string | null) => (BRANCHES_ENABLED ? ` · ${branchName(id)}` : "");

  // One group per branch, one column per kind of movement.
  const { points, tiles } = useMemo(() => {
    const per = new Map<string, Record<string, number>>();
    const tiles = { changes: 0, sold: 0, received: 0, adjustments: 0, writtenOff: 0 };
    for (const t of current?.totals ?? []) {
      const id = t.branchId ?? "none";
      const row = per.get(id) ?? {};
      for (const m of MOVES) {
        if ((m.types as readonly string[]).includes(t.type)) row[m.key] = (row[m.key] ?? 0) + Math.abs(t.units);
      }
      per.set(id, row);
      tiles.changes += t.count;
      if (t.type === "sale") tiles.sold += Math.abs(t.units);
      if (t.type === "receive" || t.type === "import") tiles.received += Math.abs(t.units);
      if (t.type === "adjust") tiles.adjustments += t.count;
      if (t.type === "write-off") tiles.writtenOff += Math.abs(t.units);
    }
    // Every open branch gets a group, even a quiet one.
    const ids = [...new Set([...data.branches.filter((b) => b.active).map((b) => b.id), ...per.keys()])].filter(
      (id) => id !== "none" || per.has("none"),
    );
    const shown = data.viewBranchId ? ids.filter((id) => id === data.viewBranchId) : ids;
    const points: ChartPoint[] = shown.map((id) => ({
      label: id === "none" ? "Unassigned" : branchName(id),
      values: Object.fromEntries(MOVES.map((m) => [m.key, per.get(id)?.[m.key] ?? 0])),
    }));
    return { points, tiles };
  }, [current, data.branches, data.viewBranchId, branchName]);

  const flagged = (current?.events ?? []).filter((e) => e.flagged).slice(0, 6);
  const recent = (current?.events ?? []).slice(0, 12);

  return (
    <section className="space-y-4" aria-labelledby="inventory-activity-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="inventory-activity-heading" className="font-display text-lg font-semibold text-teal-950">
            Inventory security
          </h2>
          <p className="text-xs text-zinc-500">
            Every stock and price change is recorded with who made it. Suspicious ones are flagged.
          </p>
        </div>
        <div className="flex gap-2 text-xs font-semibold">
          <button
            onClick={() => setReloads((n) => n + 1)}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700 hover:bg-zinc-50"
          >
            Refresh
          </button>
          <Link href="/admin/stock-log" className="rounded-lg bg-teal-700 px-3 py-1.5 text-white hover:bg-teal-800">
            Full stock log
          </Link>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!current && !error && (
        <p className="rounded-2xl bg-white/70 p-6 text-center text-sm text-zinc-400">Loading inventory activity…</p>
      )}

      {current && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile label="Changes recorded" value={tiles.changes} />
            <Tile label="Units sold" value={tiles.sold} />
            <Tile label="Units received" value={tiles.received} />
            <Tile label="Manual counts" value={tiles.adjustments} tone={tiles.adjustments ? "amber" : undefined} />
            <Tile
              label="Flagged"
              value={current.flaggedCount}
              tone={current.flaggedCount ? "red" : "green"}
              hint={current.flaggedCount ? "Need a second look" : "Nothing suspicious"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <ChartCard
              title={BRANCHES_ENABLED ? "Stock movement by branch" : "Stock movement"}
              subtitle="Units moved in the period, by kind of change"
              table={{
                columns: ["Branch", ...MOVES.map((m) => m.label)],
                rows: points.map((p) => [p.label, ...MOVES.map((m) => p.values[m.key] ?? 0)]),
              }}
            >
              <ColumnChart
                points={points}
                series={MOVES.map((m) => ({ key: m.key, label: m.label, color: m.color }))}
                integerAxis
              />
            </ChartCard>

            <div className="rounded-2xl border border-teal-950/[0.07] bg-white p-4">
              <h3 className="text-sm font-semibold text-teal-950">Flagged changes</h3>
              {flagged.length === 0 ? (
                <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">
                  No suspicious changes in this period.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {flagged.map((e) => (
                    <li key={e.id} className="rounded-lg border border-rose-200 bg-rose-50/60 p-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-rose-900">{e.flagReason}</span>
                        <span className="shrink-0 text-rose-700">{when(e.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 text-zinc-700">
                        {e.medicineName} {signedUnits(e) && <strong>{signedUnits(e)}</strong>}
                        {e.details ? ` · ${e.details}` : ""}
                      </p>
                      <p className="mt-0.5 text-zinc-500">
                        {e.byName ?? "Unknown"}
                        {where(e.branchId)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {current.flaggedCount > flagged.length && (
                <Link
                  href="/admin/stock-log?flagged=1"
                  className="mt-2 inline-block text-xs font-semibold text-rose-700 underline"
                >
                  See all {current.flaggedCount} flagged
                </Link>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-teal-950/[0.07] bg-white">
            <h3 className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold text-teal-950">Latest changes</h3>
            {recent.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-400">No stock changes in this period.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 text-sm">
                {recent.map((e) => (
                  <li key={e.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2", e.flagged && "bg-rose-50/50")}>
                    <span className="w-24 shrink-0 text-xs tabular-nums text-zinc-500">{when(e.createdAt)}</span>
                    <EventBadge type={e.type} />
                    <span className="min-w-0 flex-1 truncate">
                      <strong className="font-medium text-zinc-900">{e.medicineName}</strong>
                      {e.details && <span className="text-zinc-500"> · {e.details}</span>}
                    </span>
                    <span
                      className={cn(
                        "w-14 text-right font-semibold tabular-nums",
                        e.quantity < 0 ? "text-rose-700" : "text-emerald-700",
                      )}
                    >
                      {signedUnits(e)}
                    </span>
                    <span className="w-40 truncate text-right text-xs text-zinc-500">
                      {e.byName ?? "—"}
                      {where(e.branchId)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "red" | "amber" | "green";
}) {
  const tones = {
    red: "border-rose-200 bg-rose-50 text-rose-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };
  return (
    <div className={cn("rounded-2xl border p-3", tone ? tones[tone] : "border-teal-950/[0.07] bg-white text-zinc-900")}>
      <p className="text-[10px] font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value.toLocaleString("en-KE")}</p>
      {hint && <p className="text-[11px] opacity-80">{hint}</p>}
    </div>
  );
}
