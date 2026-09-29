"use client";

// The full inventory audit trail: every stock and price change, who made it,
// at which branch, and the count right after. Filter it, search it, export it.
// Entries can't be edited or deleted — there is no way to do so in the system.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useClinic } from "@/lib/store";
import { Button, Card, PageHeader, cn, inputClass } from "@/components/ui";
import { downloadCsv, exportDateTime, fileStamp, toCsv } from "@/lib/export";
import { BRANCHES_ENABLED } from "@/lib/features";
import {
  EVENT_LABELS,
  EventBadge,
  fetchInventoryLog,
  signedUnits,
  type EventType,
  type InventoryLog,
} from "@/components/InventoryEvents";

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIODS = [
  { key: "1", label: "Today" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "365", label: "1 year" },
] as const;

export default function StockLogPage() {
  // useSearchParams (for ?flagged=1 from the dashboard) needs a boundary.
  return (
    <Suspense fallback={null}>
      <StockLog />
    </Suspense>
  );
}

function StockLog() {
  const data = useClinic();
  const params = useSearchParams();
  const [period, setPeriod] = useState<string>("30");
  const [type, setType] = useState<EventType | "">("");
  const [flaggedOnly, setFlaggedOnly] = useState(params.get("flagged") === "1");
  const [branch, setBranch] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState(""); // debounced copy of `query`
  const [log, setLog] = useState<{ key: string; data: InventoryLog } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Midnight today, so "Today" means the calendar day.
  const from = useMemo(() => {
    const midnight = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    return midnight - (Number(period) - 1) * DAY_MS;
  }, [period]);

  const key = `${from}-${type}-${flaggedOnly}-${branch}-${search}-${data.viewBranchId}`;
  useEffect(() => {
    let cancelled = false;
    fetchInventoryLog({
      from,
      type: type || undefined,
      flagged: flaggedOnly ? 1 : undefined,
      branch,
      q: search || undefined,
      limit: 500,
    })
      .then((d) => {
        if (cancelled) return;
        setLog({ key, data: d });
        setError(null);
      })
      .catch(() => !cancelled && setError("Could not load the stock log."));
    return () => {
      cancelled = true;
    };
  }, [key, from, type, flaggedOnly, branch, search]);

  const current = log?.key === key ? log.data : null;
  const branchName = (id: string | null) =>
    id ? (data.branches.find((b) => b.id === id)?.name ?? "Removed branch") : "—";
  const multiBranch =
    BRANCHES_ENABLED && data.canSwitchBranch && data.branches.filter((b) => b.active).length > 1;

  const exportCsv = () => {
    if (!current) return;
    downloadCsv(
      `stock-log_${fileStamp()}.csv`,
      toCsv(
        [
          { header: "When", value: (e) => exportDateTime(e.createdAt) },
          { header: "Change", value: (e) => EVENT_LABELS[e.type] },
          { header: "Medicine", value: (e) => e.medicineName },
          { header: "Units", value: (e) => (e.type === "price" || e.type === "edit" ? "" : e.quantity) },
          { header: "Count after", value: (e) => e.stockAfter ?? "" },
          { header: "Details", value: (e) => e.details ?? "" },
          { header: "Reference", value: (e) => e.reference ?? "" },
          { header: "By", value: (e) => e.byName ?? "" },
          { header: "Branch", value: (e) => branchName(e.branchId) },
          { header: "Flag", value: (e) => e.flagReason ?? "" },
        ],
        current.events,
      ),
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock log"
        subtitle="Every stock and price change — who made it, where, and the count after. Entries can't be edited or deleted."
      />

      <Card className="flex flex-wrap items-end gap-3">
        <div className="flex rounded-lg border border-zinc-200 p-0.5 text-xs font-medium">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              aria-pressed={period === p.key}
              className={cn("rounded-md px-2.5 py-1", period === p.key ? "bg-teal-700 text-white" : "text-zinc-600 hover:bg-zinc-50")}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select
          className={cn(inputClass, "h-8 w-44 text-xs")}
          value={type}
          onChange={(e) => setType(e.target.value as EventType | "")}
          aria-label="Kind of change"
        >
          <option value="">All kinds of change</option>
          {(Object.keys(EVENT_LABELS) as EventType[]).map((t) => (
            <option key={t} value={t}>
              {EVENT_LABELS[t]}
            </option>
          ))}
        </select>
        {multiBranch && (
          <select
            className={cn(inputClass, "h-8 w-44 text-xs")}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            aria-label="Branch"
          >
            <option value="all">All branches</option>
            {data.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <input
          className={cn(inputClass, "h-8 w-52 text-xs")}
          placeholder="Search medicine…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-xs font-medium text-rose-800">
          <input
            type="checkbox"
            className="accent-rose-700"
            checked={flaggedOnly}
            onChange={(e) => setFlaggedOnly(e.target.checked)}
          />
          Flagged only
        </label>
        <Button size="sm" variant="secondary" className="ml-auto" disabled={!current?.events.length} onClick={exportCsv}>
          Export CSV
        </Button>
      </Card>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 text-xs text-zinc-500">
          <span>
            {current ? `${current.events.length}${current.events.length === 500 ? "+" : ""} changes` : "Loading…"}
          </span>
          {current && current.flaggedCount > 0 && (
            <span className="font-semibold text-rose-700">{current.flaggedCount} flagged in this period</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="py-2 pl-4 font-semibold">When</th>
                <th className="py-2 font-semibold">Change</th>
                <th className="py-2 font-semibold">Medicine</th>
                <th className="py-2 text-right font-semibold">Units</th>
                <th className="py-2 text-right font-semibold">After</th>
                <th className="py-2 pl-4 font-semibold">Details</th>
                <th className="py-2 font-semibold">By</th>
                {multiBranch && <th className="py-2 pr-4 font-semibold">Branch</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {(current?.events ?? []).map((e) => (
                <tr key={e.id} className={cn("align-top", e.flagged && "bg-rose-50/60")}>
                  <td className="whitespace-nowrap py-2 pl-4 text-xs text-zinc-500">{exportDateTime(e.createdAt)}</td>
                  <td className="py-2">
                    <EventBadge type={e.type} />
                  </td>
                  <td className="py-2 font-medium text-zinc-900">{e.medicineName}</td>
                  <td className={cn("py-2 text-right font-semibold tabular-nums", e.quantity < 0 ? "text-rose-700" : "text-emerald-700")}>
                    {signedUnits(e)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-zinc-500">{e.stockAfter ?? ""}</td>
                  <td className="py-2 pl-4 text-xs text-zinc-600">
                    {e.details}
                    {e.flagReason && <span className="mt-0.5 block font-semibold text-rose-700">⚑ {e.flagReason}</span>}
                    {e.reference && <span className="mt-0.5 block text-[10px] text-zinc-400">{e.reference}</span>}
                  </td>
                  <td className="py-2 text-xs text-zinc-600">{e.byName ?? "—"}</td>
                  {multiBranch && <td className="py-2 pr-4 text-xs text-zinc-600">{branchName(e.branchId)}</td>}
                </tr>
              ))}
              {current && current.events.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-zinc-400">
                    No changes match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
