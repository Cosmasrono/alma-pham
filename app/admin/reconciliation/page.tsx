"use client";

// The daily money check, for admins: for each day, every payment recorded
// anywhere in the clinic (reception's pay-gates and the pharmacy POS, split by
// cash / M-Pesa / card) against (a) the physical cash the admin counted and
// (b) the M-Pesa payments Daraja actually confirmed. Any difference shows as a
// red variance, so missing money is caught same-day.

import { useMemo, useState } from "react";
import { recordCashCount, useClinic } from "@/lib/store";
import { paymentsOf } from "@/lib/selectors";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  cn,
  inputClass,
} from "@/components/ui";

const money = (n: number) =>
  `KSh ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

type Period = "today" | "7d" | "30d" | "all";

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "all", label: "All time" },
];

function periodStart(period: Period): number {
  const now = new Date();
  if (period === "all") return 0;
  if (period === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  const days = period === "7d" ? 7 : 30;
  return now.getTime() - days * 24 * 60 * 60 * 1000;
}

/** Local calendar day of an ISO timestamp, as "YYYY-MM-DD". */
function dayOf(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

interface DayRow {
  day: string;
  cash: number;
  mpesa: number;
  card: number;
  mpesaConfirmed: number;
  counted?: number;
  countedBy?: string;
  notes?: string;
}

function Variance({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-zinc-400">not counted</span>;
  }
  const ok = Math.abs(value) < 1;
  return (
    <span className={cn("font-semibold", ok ? "text-teal-700" : "text-rose-600")}>
      {ok ? "Balanced" : `${value > 0 ? "+" : "−"} ${money(Math.abs(value))}`}
    </span>
  );
}

export default function ReconciliationPage() {
  const data = useClinic();
  const [period, setPeriod] = useState<Period>("7d");
  const [editing, setEditing] = useState<string | null>(null); // day being counted
  const [countInput, setCountInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const rows = useMemo<DayRow[]>(() => {
    const start = periodStart(period);
    const byDay = new Map<string, DayRow>();
    const row = (day: string): DayRow => {
      let r = byDay.get(day);
      if (!r) {
        r = { day, cash: 0, mpesa: 0, card: 0, mpesaConfirmed: 0 };
        byDay.set(day, r);
      }
      return r;
    };

    // Every payment on every visit — a per-stage patient pays reception for
    // the consultation and their labs before the pharmacy ever sees them, and
    // all of that cash has to show up in the day's count.
    for (const v of data.visits) {
      for (const p of paymentsOf(v)) {
        if (new Date(p.paidAt).getTime() < start) continue;
        const r = row(dayOf(p.paidAt));
        if (p.method === "cash") r.cash += p.amount;
        else if (p.method === "mpesa") r.mpesa += p.amount;
        else r.card += p.amount;
      }
    }
    for (const t of data.mpesaTransactions) {
      if (t.status !== "success") continue;
      if (new Date(t.createdAt).getTime() < start) continue;
      row(dayOf(t.createdAt)).mpesaConfirmed += t.amount;
    }
    for (const c of data.cashCounts) {
      if (new Date(`${c.date}T23:59:59`).getTime() < start) continue;
      const r = row(c.date);
      r.counted = c.counted;
      r.countedBy = c.countedBy;
      r.notes = c.notes;
    }

    return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  }, [data, period]);

  const totals = useMemo(() => {
    const t = {
      cash: 0,
      mpesa: 0,
      card: 0,
      mpesaConfirmed: 0,
      cashVariance: 0,
      anyCounted: false,
    };
    for (const r of rows) {
      t.cash += r.cash;
      t.mpesa += r.mpesa;
      t.card += r.card;
      t.mpesaConfirmed += r.mpesaConfirmed;
      if (r.counted !== undefined) {
        t.cashVariance += r.counted - r.cash;
        t.anyCounted = true;
      }
    }
    return t;
  }, [rows]);

  function startCount(r: DayRow) {
    setEditing(r.day);
    setCountInput(r.counted !== undefined ? String(r.counted) : "");
    setNotesInput(r.notes ?? "");
  }

  async function runAiCheck() {
    setAiBusy(true);
    setAiError(null);
    setAiAnalysis(null);
    try {
      const start = periodStart(period);
      const res = await fetch("/api/ai/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: start > 0 ? dayOf(new Date(start).toISOString()) : "2000-01-01",
          to: dayOf(new Date().toISOString()),
        }),
      });
      const body = (await res.json()) as { analysis?: string; error?: string };
      if (!res.ok || !body.analysis) {
        setAiError(body.error ?? "AI check failed. Please try again.");
      } else {
        setAiAnalysis(body.analysis);
      }
    } catch {
      setAiError("Network error. Please try again.");
    } finally {
      setAiBusy(false);
    }
  }

  async function saveCount(day: string) {
    setSaving(true);
    const error = await recordCashCount({
      date: day,
      counted: Number(countInput),
      notes: notesInput || undefined,
    });
    setSaving(false);
    if (!error) setEditing(null);
  }

  return (
    <div>
      <PageHeader
        title="Reconciliation"
        subtitle="Recorded payments vs counted cash and confirmed M-Pesa, day by day."
        action={
          <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={runAiCheck} disabled={aiBusy || rows.length === 0}>
            {aiBusy ? "Analyzing…" : "✨ Run AI check"}
          </Button>
          <div className="flex rounded-full border border-zinc-200 bg-white p-0.5 text-sm">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 font-medium transition-colors",
                  period === p.key
                    ? "bg-teal-700 text-white"
                    : "text-zinc-600 hover:text-zinc-900",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          </div>
        }
      />

      {aiError && (
        <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {aiError}
        </div>
      )}
      {aiAnalysis && (
        <Card className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              ✨ AI reconciliation check
            </p>
            <Button size="sm" variant="ghost" onClick={() => setAiAnalysis(null)}>
              Dismiss
            </Button>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800">
            {aiAnalysis}
          </p>
        </Card>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Cash recorded
          </p>
          <p className="mt-1 text-xl font-bold text-zinc-900">{money(totals.cash)}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Cash variance (counted days)
          </p>
          <p className="mt-1 text-xl font-bold">
            <Variance value={totals.anyCounted ? totals.cashVariance : null} />
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            M-Pesa recorded
          </p>
          <p className="mt-1 text-xl font-bold text-zinc-900">{money(totals.mpesa)}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            M-Pesa variance
          </p>
          <p className="mt-1 text-xl font-bold">
            <Variance
              value={rows.length ? totals.mpesaConfirmed - totals.mpesa : null}
            />
          </p>
        </Card>
      </div>

      {rows.length === 0 ? (
        <EmptyState>No payments recorded in this period.</EmptyState>
      ) : (
        <Card className="overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-3">Day</th>
                <th className="px-4 py-3 text-right">Cash recorded</th>
                <th className="px-4 py-3 text-right">Cash counted</th>
                <th className="px-4 py-3 text-right">Cash variance</th>
                <th className="px-4 py-3 text-right">M-Pesa recorded</th>
                <th className="px-4 py-3 text-right">M-Pesa confirmed</th>
                <th className="px-4 py-3 text-right">M-Pesa variance</th>
                <th className="px-4 py-3 text-right">Card</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cashVariance =
                  r.counted !== undefined ? r.counted - r.cash : null;
                const mpesaVariance = r.mpesaConfirmed - r.mpesa;
                const flagged =
                  (cashVariance !== null && Math.abs(cashVariance) >= 1) ||
                  Math.abs(mpesaVariance) >= 1;
                return (
                  <tr
                    key={r.day}
                    className={cn(
                      "border-b border-zinc-50 last:border-0",
                      flagged && "bg-rose-50/60",
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-zinc-900">
                      {new Date(`${r.day}T12:00:00`).toLocaleDateString("en-KE", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                      {r.countedBy && (
                        <span className="block text-xs font-normal text-zinc-400">
                          counted by {r.countedBy}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{money(r.cash)}</td>
                    <td className="px-4 py-3 text-right">
                      {editing === r.day ? (
                        <input
                          type="number"
                          min={0}
                          autoFocus
                          className={cn(inputClass, "!h-8 w-28 text-right")}
                          value={countInput}
                          onChange={(e) => setCountInput(e.target.value)}
                        />
                      ) : r.counted !== undefined ? (
                        money(r.counted)
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Variance value={cashVariance} />
                    </td>
                    <td className="px-4 py-3 text-right">{money(r.mpesa)}</td>
                    <td className="px-4 py-3 text-right">{money(r.mpesaConfirmed)}</td>
                    <td className="px-4 py-3 text-right">
                      <Variance value={mpesaVariance} />
                    </td>
                    <td className="px-4 py-3 text-right">{money(r.card)}</td>
                    <td className="px-4 py-3 text-right">
                      {editing === r.day ? (
                        <span className="flex items-center justify-end gap-1.5">
                          <input
                            className={cn(inputClass, "!h-8 w-32")}
                            placeholder="Notes (optional)"
                            value={notesInput}
                            onChange={(e) => setNotesInput(e.target.value)}
                          />
                          <Button
                            size="sm"
                            disabled={saving || countInput === ""}
                            onClick={() => saveCount(r.day)}
                          >
                            {saving ? "Saving…" : "Save"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => startCount(r)}>
                          {r.counted !== undefined ? "Recount" : "Enter count"}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <p className="mt-3 text-xs text-zinc-400">
        Cash variance = physically counted cash − cash recorded on that day&apos;s
        visits. M-Pesa variance = Daraja-confirmed payments − M-Pesa recorded on
        visits. Cross-check confirmed M-Pesa against your Safaricom statement
        periodically.
      </p>
    </div>
  );
}
