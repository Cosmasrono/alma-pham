"use client";

// Every branch side by side on the admin dashboard: revenue trends, how each
// compares with its previous period, patient flow, stock health and tills —
// with one-click actions to step into a branch, move stock or manage it.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { switchBranch, useClinic } from "@/lib/store";
import {
  ChartCard,
  SERIES_COLORS,
  TrendChart,
  type ChartPoint,
} from "@/components/charts";
import { cn } from "@/components/ui";
import { compactMoney, money, pctChange, type Range } from "@/lib/analytics";
import { formatDuration } from "@/lib/selectors";
import type { BranchOverview as Overview, BranchStats } from "@/lib/server/branch-stats";

const moneyAxis = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

export function BranchOverview({ range }: { range: Range }) {
  const data = useClinic();
  const activeCount = data.branches.filter((b) => b.active).length;
  const [overview, setOverview] = useState<{ key: string; data: Overview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  const key = `${range.from}-${range.to}-${reloads}`;
  useEffect(() => {
    if (activeCount < 2) return;
    let cancelled = false;
    fetch(`/api/branches/overview?from=${range.from}&to=${range.to}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as Overview;
      })
      .then((d) => {
        if (cancelled) return;
        setOverview({ key, data: d });
        setError(null);
      })
      .catch(() => !cancelled && setError("Could not load the branch comparison."));
    return () => {
      cancelled = true;
    };
  }, [key, range.from, range.to, activeCount]);

  const current = overview?.key === key ? overview.data : null;

  // Active branches first, in the order the API gave (main first).
  const rows = useMemo(() => {
    if (!current) return [];
    const byId = new Map(current.stats.map((s) => [s.branchId, s]));
    return current.branches
      .filter((b) => b.active || (byId.get(b.id)?.revenue ?? 0) > 0)
      .map((b, i) => ({ branch: b, stats: byId.get(b.id)!, color: SERIES_COLORS[i % SERIES_COLORS.length] }))
      .filter((r) => r.stats);
  }, [current]);

  const points: ChartPoint[] = useMemo(
    () =>
      (current?.buckets ?? []).map((bucket, i) => ({
        label: bucket.label,
        full: bucket.full,
        values: Object.fromEntries(rows.map((r) => [r.branch.id, r.stats.series[i] ?? 0])),
      })),
    [current, rows],
  );

  const totalRevenue = rows.reduce((s, r) => s + r.stats.revenue, 0);

  if (data.branches.length === 0) return null;

  // A single-site clinic: point the admin at where branches are set up.
  if (activeCount < 2) {
    return (
      <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-teal-900/20 bg-white/70 px-4 py-3">
        <p className="text-sm text-zinc-600">
          <strong>One branch.</strong> Add another location to compare branches side by side here.
        </p>
        <Link
          href="/admin/branches"
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
        >
          Manage branches
        </Link>
      </section>
    );
  }

  const enter = async (id: string) => {
    setSwitching(id);
    await switchBranch(id);
    setSwitching(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <section className="mb-6 space-y-4" aria-labelledby="branches-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="branches-heading" className="font-display text-lg font-semibold text-teal-950">
            Branches
          </h2>
          <p className="text-xs text-zinc-500">
            Every branch for the selected period, whichever branch you&apos;re viewing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <button
            onClick={() => setReloads((n) => n + 1)}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700 hover:bg-zinc-50"
          >
            Refresh
          </button>
          <Link href="/admin/transfers" className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700 hover:bg-zinc-50">
            Transfer stock
          </Link>
          <Link href="/admin/users" className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700 hover:bg-zinc-50">
            Assign staff
          </Link>
          <Link href="/admin/branches" className="rounded-lg bg-teal-700 px-3 py-1.5 text-white hover:bg-teal-800">
            Manage branches
          </Link>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!current && !error && (
        <p className="rounded-2xl bg-white/70 p-6 text-center text-sm text-zinc-400">Loading branches…</p>
      )}

      {current && (
        <>
          <ChartCard
            title="Revenue by branch"
            subtitle={`${money(totalRevenue)} across ${rows.length} branches`}
            table={{
              columns: ["Branch", "Revenue", "vs previous", "In-house", "Community", "Visits", "Walk-in sales"],
              rows: rows.map(({ branch, stats }) => {
                const d = pctChange(stats.revenue, stats.previousRevenue);
                return [
                  branch.name,
                  money(stats.revenue),
                  d === null ? "—" : `${d >= 0 ? "+" : ""}${Math.round(d)}%`,
                  money(stats.inHouseRevenue),
                  money(stats.communityRevenue),
                  stats.visits,
                  stats.walkInSales,
                ];
              }),
            }}
          >
            <TrendChart
              points={points}
              series={rows.map((r) => ({ key: r.branch.id, label: r.branch.name, color: r.color }))}
              format={money}
              formatAxis={moneyAxis}
            />
          </ChartCard>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map(({ branch, stats, color }) => (
              <BranchCard
                key={branch.id}
                branch={branch}
                stats={stats}
                color={color}
                share={totalRevenue > 0 ? stats.revenue / totalRevenue : 0}
                viewing={data.viewBranchId === branch.id}
                switching={switching === branch.id}
                onEnter={() => void enter(branch.id)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function BranchCard({
  branch,
  stats,
  color,
  share,
  viewing,
  switching,
  onEnter,
}: {
  branch: Overview["branches"][number];
  stats: BranchStats;
  color: string;
  share: number;
  viewing: boolean;
  switching: boolean;
  onEnter: () => void;
}) {
  const delta = pctChange(stats.revenue, stats.previousRevenue);
  const communityShare = stats.revenue > 0 ? stats.communityRevenue / stats.revenue : 0;
  const alerts = [
    stats.stock.expiredUnits > 0 && { text: `${stats.stock.expiredUnits} expired units to write off`, tone: "red" },
    stats.tills.discrepancies > 0 && {
      text: `${stats.tills.discrepancies} till discrepanc${stats.tills.discrepancies === 1 ? "y" : "ies"} (${money(Math.abs(stats.tills.netShortage))} ${stats.tills.netShortage < 0 ? "short" : "over"})`,
      tone: "red",
    },
    stats.stock.outOfStock > 0 && { text: `${stats.stock.outOfStock} medicines out of stock`, tone: "amber" },
    stats.stock.lowStock > 0 && { text: `${stats.stock.lowStock} low on stock`, tone: "amber" },
    stats.stock.expiringUnits > 0 && { text: `${stats.stock.expiringUnits} units expire within 90 days`, tone: "amber" },
  ].filter(Boolean) as { text: string; tone: "red" | "amber" }[];

  return (
    <article
      className={cn(
        "flex flex-col rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgb(4_47_43/0.04)]",
        viewing ? "border-teal-500 ring-1 ring-teal-500" : "border-teal-950/[0.07]",
        !branch.active && "opacity-60",
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 truncate text-sm font-semibold text-teal-950">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            {branch.name}
          </h3>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
            {branch.code}
            {branch.isMain && " · main"}
            {!branch.active && " · closed"}
            {` · ${stats.staff} staff`}
          </p>
        </div>
        {stats.openNow > 0 && (
          <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-800">
            {stats.openNow} in clinic now
          </span>
        )}
      </header>

      <div className="mt-3 flex items-baseline gap-2">
        <p className="text-2xl font-bold tracking-tight text-zinc-900">{compactMoney(stats.revenue)}</p>
        {delta !== null && (
          <span className={cn("text-xs font-semibold", delta >= 0 ? "text-emerald-700" : "text-rose-700")}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(delta))}%
          </span>
        )}
        <span className="ml-auto text-[11px] text-zinc-400">{Math.round(share * 100)}% of total</span>
      </div>

      {/* In-house vs community split of this branch's revenue */}
      <div className="mt-2">
        <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
          <div className="bg-sky-500" style={{ width: `${(1 - communityShare) * 100}%` }} />
          <div className="bg-violet-500" style={{ width: `${communityShare * 100}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
          <span>In-house {money(stats.inHouseRevenue)}</span>
          <span>Community {money(stats.communityRevenue)}</span>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Metric label="Visits" value={String(stats.visits)} />
        <Metric label="Avg time" value={stats.avgVisitMs !== null ? formatDuration(stats.avgVisitMs) : "—"} />
        <Metric label="Walk-in sales" value={String(stats.walkInSales)} />
        <Metric label="Stock value" value={compactMoney(stats.stock.valueRetail)} />
        <Metric label="Tills open" value={String(stats.tills.open)} />
        <Metric label="Payments" value={String(stats.payments)} />
      </dl>

      {alerts.length > 0 ? (
        <ul className="mt-3 space-y-1 text-[11px]">
          {alerts.map((a) => (
            <li
              key={a.text}
              className={cn(
                "rounded-md px-2 py-1",
                a.tone === "red" ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-800",
              )}
            >
              {a.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-md bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">
          No stock or till issues.
        </p>
      )}

      <div className="mt-auto flex gap-2 pt-3 text-xs font-semibold">
        {branch.active && (
          <button
            onClick={onEnter}
            disabled={viewing || switching}
            className="flex-1 rounded-lg bg-teal-700 px-3 py-1.5 text-white hover:bg-teal-800 disabled:bg-teal-100 disabled:text-teal-800"
          >
            {viewing ? "Viewing now" : switching ? "Opening…" : "Open branch"}
          </button>
        )}
        <Link
          href="/admin/transfers"
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-zinc-700 hover:bg-zinc-50"
        >
          Stock
        </Link>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-1 py-1.5">
      <dd className="text-sm font-semibold tabular-nums text-zinc-900">{value}</dd>
      <dt className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</dt>
    </div>
  );
}
