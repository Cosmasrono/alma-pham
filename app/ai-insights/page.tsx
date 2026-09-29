"use client";

// AI inventory insights: what each medicine will sell in the next 30 days,
// how much to reorder, what risks running out, and what risks expiring on the
// shelf — plus an audit of payments against sales.

import { useEffect, useMemo, useState } from "react";
import { SparklesIcon } from "lucide-react";
import { useClinic } from "@/lib/store";
import { Button, Card, EmptyState, PageHeader, cn } from "@/components/ui";
import { medicineLabel, money } from "@/components/SaleReceipt";

type Risk = "none" | "low" | "medium" | "high";

interface Prediction {
  medicineId: string;
  predictedDemandNext30Days: number;
  recommendedReorderQuantity: number;
  stockoutRisk: Risk;
  expiryRisk: Risk;
  confidence: number;
  reasoning: string;
  snapshot: { sellable: number; expired: number; sold30: number; sold90: number; expiringSoon: number };
}

interface Insight {
  summary: string;
  paymentAudit: string | null;
  predictions: Prediction[];
  paymentSnapshot: Record<string, number> | null;
  generatedAt: string;
  generatedBy: string | null;
  model: string | null;
}

const RISK_RANK: Record<Risk, number> = { high: 0, medium: 1, low: 2, none: 3 };
const RISK_STYLE: Record<Risk, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-zinc-100 text-zinc-600",
  none: "bg-teal-50 text-teal-700",
};

type Filter = "all" | "reorder" | "stockout" | "expiry";

export default function AiInsightsPage() {
  const data = useClinic();
  // Each branch has its own analysis. Remember which branch a loaded analysis
  // belongs to, so switching branch never shows the previous branch's.
  const view = data.viewBranchId;
  const [loaded, setLoaded] = useState<{ view: string | null; insight: Insight | null } | null>(null);
  const [configured, setConfigured] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const loading = loaded?.view !== view;
  const insight = loading ? null : (loaded?.insight ?? null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/insights")
      .then((r) => r.json())
      .then((b: { insight: Insight | null; configured: boolean }) => {
        if (cancelled) return;
        setLoaded({ view, insight: b.insight });
        setConfigured(b.configured);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded({ view, insight: null });
        setError("Could not load the last analysis.");
      });
    return () => {
      cancelled = true;
    };
  }, [view]);

  const generate = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/insights", { method: "POST" });
      const body = (await res.json()) as { insight?: Insight; error?: string };
      if (!res.ok || !body.insight) setError(body.error ?? "The analysis failed. Try again.");
      else setLoaded({ view, insight: body.insight });
    } catch {
      setError("The analysis failed — check your connection and try again.");
    } finally {
      setRunning(false);
    }
  };

  const medicines = useMemo(() => new Map(data.medicines.map((m) => [m.id, m])), [data.medicines]);

  const rows = useMemo(() => {
    const list = (insight?.predictions ?? []).filter((p) =>
      filter === "reorder"
        ? p.recommendedReorderQuantity > 0
        : filter === "stockout"
          ? p.stockoutRisk === "high" || p.stockoutRisk === "medium"
          : filter === "expiry"
            ? p.expiryRisk === "high" || p.expiryRisk === "medium"
            : true,
    );
    return [...list].sort(
      (a, b) =>
        Math.min(RISK_RANK[a.stockoutRisk], RISK_RANK[a.expiryRisk]) -
          Math.min(RISK_RANK[b.stockoutRisk], RISK_RANK[b.expiryRisk]) ||
        b.recommendedReorderQuantity - a.recommendedReorderQuantity,
    );
  }, [insight, filter]);

  const counts = useMemo(() => {
    const p = insight?.predictions ?? [];
    return {
      reorder: p.filter((x) => x.recommendedReorderQuantity > 0).length,
      stockout: p.filter((x) => x.stockoutRisk === "high" || x.stockoutRisk === "medium").length,
      expiry: p.filter((x) => x.expiryRisk === "high" || x.expiryRisk === "medium").length,
      reorderCost: p.reduce(
        (s, x) => s + x.recommendedReorderQuantity * (medicines.get(x.medicineId)?.costPrice ?? 0),
        0,
      ),
    };
  }, [insight, medicines]);

  const snap = insight?.paymentSnapshot;

  return (
    <div>
      <PageHeader
        title="AI insights"
        subtitle="Demand forecast, reorder advice, stockout and expiry risk — from the last 90 days of sales in both pharmacies"
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          {insight
            ? `Last analysed ${new Date(insight.generatedAt).toLocaleString()}${insight.generatedBy ? ` by ${insight.generatedBy}` : ""}`
            : loading
              ? "Loading…"
              : "No analysis yet."}
        </p>
        <Button onClick={generate} disabled={running || !configured}>
          <SparklesIcon className="size-4" />
          {running ? "Analysing… (up to a minute)" : insight ? "Run a fresh analysis" : "Run the first analysis"}
        </Button>
      </div>

      {!configured && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          AI isn&apos;t configured on this server. Add GROQ_API_KEY to .env and restart.
        </p>
      )}
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {!insight ? (
        !loading && (
          <EmptyState>
            Run an analysis to get a 30-day demand forecast and reorder list for every medicine.
          </EmptyState>
        )
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="text-sm font-semibold text-zinc-700">Inventory summary</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-700">{insight.summary}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Stat label="To reorder" value={counts.reorder} tone="teal" />
                <Stat label="Stockout risk" value={counts.stockout} tone={counts.stockout ? "red" : "zinc"} />
                <Stat label="Expiry risk" value={counts.expiry} tone={counts.expiry ? "amber" : "zinc"} />
              </div>
              {counts.reorderCost > 0 && (
                <p className="mt-3 text-xs text-zinc-500">
                  Suggested reorder costs about <strong>{money(counts.reorderCost)}</strong> at current
                  supplier prices.
                </p>
              )}
            </Card>
            <Card>
              <h2 className="text-sm font-semibold text-zinc-700">Payment audit · last 30 days</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-700">
                {insight.paymentAudit ?? "No payment audit returned."}
              </p>
              {snap && (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-600">
                  <Pair label="Collected" value={money(snap.collected ?? 0)} />
                  <Pair label="Billed" value={money(snap.billed ?? 0)} />
                  <Pair label="In-house sales" value={money(snap.inHouseSales ?? 0)} />
                  <Pair label="Community sales" value={money(snap.communitySales ?? 0)} />
                  <Pair label="M-Pesa recorded" value={money(snap.mpesa ?? 0)} />
                  <Pair label="M-Pesa confirmed" value={money(snap.mpesaConfirmedByProvider ?? 0)} />
                </dl>
              )}
            </Card>
          </div>

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-700">Forecast per medicine</h2>
              <div className="flex rounded-lg border border-zinc-200 p-0.5 text-xs font-medium">
                {(
                  [
                    ["all", `All (${insight.predictions.length})`],
                    ["reorder", `Reorder (${counts.reorder})`],
                    ["stockout", `Stockout risk (${counts.stockout})`],
                    ["expiry", `Expiry risk (${counts.expiry})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    aria-pressed={filter === key}
                    className={cn(
                      "rounded-md px-2.5 py-1",
                      filter === key ? "bg-teal-700 text-white" : "text-zinc-600 hover:bg-zinc-50",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-400">Nothing in this view.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-xs">
                  <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                    <tr>
                      <th className="py-2 pl-3 font-semibold">Medicine</th>
                      <th className="py-2 text-right font-semibold">Sellable</th>
                      <th className="py-2 text-right font-semibold">Sold 30d / 90d</th>
                      <th className="py-2 text-right font-semibold">Forecast 30d</th>
                      <th className="py-2 text-right font-semibold">Reorder</th>
                      <th className="py-2 pl-3 font-semibold">Stockout</th>
                      <th className="py-2 font-semibold">Expiry</th>
                      <th className="py-2 pr-3 font-semibold">Why</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {rows.map((p) => {
                      const m = medicines.get(p.medicineId);
                      return (
                        <tr key={p.medicineId} className="align-top hover:bg-teal-50/40">
                          <td className="py-2.5 pl-3 font-medium text-zinc-900">
                            {m ? medicineLabel(m) : "Removed medicine"}
                            {p.snapshot.expired > 0 && (
                              <span className="ml-1.5 rounded bg-red-50 px-1 text-[10px] text-red-700">
                                {p.snapshot.expired} expired
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 text-right tabular-nums">{p.snapshot.sellable}</td>
                          <td className="py-2.5 text-right tabular-nums text-zinc-500">
                            {p.snapshot.sold30} / {p.snapshot.sold90}
                          </td>
                          <td className="py-2.5 text-right font-semibold tabular-nums">
                            {p.predictedDemandNext30Days}
                          </td>
                          <td className="py-2.5 text-right font-bold tabular-nums text-teal-700">
                            {p.recommendedReorderQuantity || "—"}
                          </td>
                          <td className="py-2.5 pl-3">
                            <RiskBadge risk={p.stockoutRisk} />
                          </td>
                          <td className="py-2.5">
                            <RiskBadge risk={p.expiryRisk} />
                            {p.snapshot.expiringSoon > 0 && (
                              <span className="ml-1 text-[10px] text-zinc-400">
                                {p.snapshot.expiringSoon} ≤90d
                              </span>
                            )}
                          </td>
                          <td className="max-w-xs py-2.5 pr-3 text-zinc-600">
                            {p.reasoning}
                            <span className="ml-1 text-[10px] text-zinc-400">
                              ({Math.round(p.confidence * 100)}% confident)
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[11px] text-zinc-400">
              Forecasts are AI estimates from past sales — check them against what you know (seasons,
              outbreaks, promotions) before ordering.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}

function RiskBadge({ risk }: { risk: Risk }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", RISK_STYLE[risk])}>
      {risk}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "teal" | "red" | "amber" | "zinc" }) {
  const tones = {
    teal: "bg-teal-50 text-teal-800",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-800",
    zinc: "bg-zinc-50 text-zinc-600",
  };
  return (
    <div className={cn("rounded-xl p-2", tones[tone])}>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-[10px] font-medium uppercase tracking-wide">{label}</div>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{label}</dt>
      <dd className="font-semibold tabular-nums text-zinc-800">{value}</dd>
    </div>
  );
}
