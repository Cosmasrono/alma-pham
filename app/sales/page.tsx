"use client";

// Every medicine sale in the clinic, newest first, each marked by where it
// happened: the Clinic pharmacy (a patient who went through the clinic) or the
// Walk-in counter (a customer who only came to buy medicine). Filter by
// period, source, payment method or search; expand a sale to see its items;
// export to CSV.

import { Fragment, useMemo, useState } from "react";
import { useClinic } from "@/lib/store";
import { Button, Card, PageHeader, cn, inputClass } from "@/components/ui";
import { isWalkIn, patientMap, payerName, paymentsOf } from "@/lib/selectors";
import { downloadCsv, exportDateTime, fileStamp, toCsv } from "@/lib/export";
import type { PaymentMethod, Visit } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIODS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
] as const;
type Period = (typeof PERIODS)[number]["key"];
type Source = "all" | "clinic" | "walk-in";

const METHOD_LABELS: Record<PaymentMethod, string> = { cash: "Cash", mpesa: "M-Pesa", card: "Card" };
const money = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

interface SaleRow {
  visit: Visit;
  at: string;
  walkIn: boolean;
  customer: string;
  mrn: string;
  items: { name: string; quantity: number; unitPrice: number }[];
  units: number;
  medicineTotal: number;
  collected: number; // everything taken at checkout (clinic: incl. consultation etc.)
  method: PaymentMethod | null;
  reference: string | null;
  cashier: string | null;
  prescriber: string | null;
}

function periodStart(period: Period): number {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  switch (period) {
    case "today":
      return midnight;
    case "7d":
      return midnight - 6 * DAY_MS;
    case "30d":
      return midnight - 29 * DAY_MS;
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    default:
      return 0;
  }
}

export default function SalesPage() {
  const data = useClinic();
  const [period, setPeriod] = useState<Period>("30d");
  const [source, setSource] = useState<Source>("all");
  const [method, setMethod] = useState<PaymentMethod | "all">("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(100);

  // Every visit that sold medicine is a sale; the closing payment dates it.
  const sales = useMemo<SaleRow[]>(() => {
    const pmap = patientMap(data);
    return data.visits
      .filter((v) => (v.saleItems?.length ?? 0) > 0)
      .map((v) => {
        const payments = paymentsOf(v);
        const last = payments.reduce<(typeof payments)[number] | null>(
          (latest, p) => (!latest || p.paidAt > latest.paidAt ? p : latest),
          null,
        );
        const items = (v.saleItems ?? []).map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice }));
        const walkIn = isWalkIn(v);
        return {
          visit: v,
          at: last?.paidAt ?? v.updatedAt,
          walkIn,
          customer: payerName(pmap, v),
          mrn: walkIn ? "" : (pmap.get(v.patientId)?.mrn ?? ""),
          items,
          units: items.reduce((s, i) => s + i.quantity, 0),
          medicineTotal: items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
          collected: last?.amount ?? 0,
          method: last?.method ?? null,
          reference: last?.reference ?? null,
          cashier: last?.takenBy ?? null,
          prescriber: v.walkIn?.prescriber
            ? `${v.walkIn.prescriber}${v.walkIn.prescriberFacility ? `, ${v.walkIn.prescriberFacility}` : ""}`
            : null,
        };
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [data]);

  const from = periodStart(period);
  const inPeriod = useMemo(() => sales.filter((s) => new Date(s.at).getTime() >= from), [sales, from]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inPeriod.filter(
      (s) =>
        (source === "all" || (source === "walk-in") === s.walkIn) &&
        (method === "all" || s.method === method) &&
        (!q ||
          `${s.customer} ${s.mrn} ${s.reference ?? ""} ${s.cashier ?? ""} ${s.items.map((i) => i.name).join(" ")}`
            .toLowerCase()
            .includes(q)),
    );
  }, [inPeriod, source, method, query]);

  // The period's split between the two pharmacies (before source/search filters).
  const summary = useMemo(() => {
    const clinic = inPeriod.filter((s) => !s.walkIn);
    const walk = inPeriod.filter((s) => s.walkIn);
    const sum = (list: SaleRow[]) => list.reduce((t, s) => t + s.medicineTotal, 0);
    return {
      count: inPeriod.length,
      value: sum(inPeriod),
      clinicCount: clinic.length,
      clinicValue: sum(clinic),
      walkCount: walk.length,
      walkValue: sum(walk),
    };
  }, [inPeriod]);
  const walkShare = summary.value > 0 ? summary.walkValue / summary.value : 0;

  const exportCsv = () =>
    downloadCsv(
      `sales_${fileStamp()}.csv`,
      toCsv(
        [
          { header: "Date & time", value: (s: SaleRow) => exportDateTime(s.at) },
          { header: "Source", value: (s) => (s.walkIn ? "Walk-in counter" : "Clinic pharmacy") },
          { header: "Customer / patient", value: (s) => s.customer },
          { header: "MRN", value: (s) => s.mrn },
          { header: "Items", value: (s) => s.items.map((i) => `${i.name} x${i.quantity}`).join("; ") },
          { header: "Units", value: (s) => s.units },
          { header: "Medicine total (KSh)", value: (s) => Math.round(s.medicineTotal) },
          { header: "Collected at checkout (KSh)", value: (s) => Math.round(s.collected) },
          { header: "Method", value: (s) => (s.method ? METHOD_LABELS[s.method] : "") },
          { header: "Reference", value: (s) => s.reference ?? "" },
          { header: "Cashier", value: (s) => s.cashier ?? "" },
          { header: "Outside prescription", value: (s) => s.prescriber ?? "" },
        ],
        filtered,
      ),
    );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales"
        subtitle="Every medicine sale — from the clinic pharmacy (patients) and the walk-in counter (customers)"
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Summary label="All sales" count={summary.count} value={summary.value} tone="teal" />
        <Summary label="Clinic pharmacy" count={summary.clinicCount} value={summary.clinicValue} tone="sky" />
        <Summary label="Walk-in counter" count={summary.walkCount} value={summary.walkValue} tone="violet" />
      </div>
      {summary.value > 0 && (
        <div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
            <div className="bg-sky-500" style={{ width: `${(1 - walkShare) * 100}%` }} />
            <div className="bg-violet-500" style={{ width: `${walkShare * 100}%` }} />
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {Math.round((1 - walkShare) * 100)}% clinic · {Math.round(walkShare * 100)}% walk-in, by medicine value
          </p>
        </div>
      )}

      <Card className="flex flex-wrap items-center gap-3">
        <Segmented
          value={period}
          onChange={(v) => {
            setPeriod(v);
            setShown(100);
          }}
          options={PERIODS.map((p) => [p.key, p.label])}
        />
        <Segmented
          value={source}
          onChange={(v) => {
            setSource(v);
            setShown(100);
          }}
          options={[
            ["all", "All"],
            ["clinic", "Clinic"],
            ["walk-in", "Walk-in"],
          ]}
        />
        <select
          className={cn(inputClass, "h-8 w-32 text-xs")}
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod | "all")}
          aria-label="Payment method"
        >
          <option value="all">Any method</option>
          <option value="cash">Cash</option>
          <option value="mpesa">M-Pesa</option>
          <option value="card">Card</option>
        </select>
        <input
          className={cn(inputClass, "h-8 w-56 text-xs")}
          placeholder="Search customer, medicine, code…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button size="sm" variant="secondary" className="ml-auto" disabled={filtered.length === 0} onClick={exportCsv}>
          Export CSV
        </Button>
      </Card>

      <Card className="p-0">
        <div className="border-b border-zinc-100 px-4 py-2.5 text-xs text-zinc-500">
          {filtered.length} sale{filtered.length === 1 ? "" : "s"} ·{" "}
          {money(filtered.reduce((s, x) => s + x.medicineTotal, 0))} in medicine
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="py-2 pl-4 font-semibold">When</th>
                <th className="py-2 font-semibold">Source</th>
                <th className="py-2 font-semibold">Customer / patient</th>
                <th className="py-2 font-semibold">Items</th>
                <th className="py-2 text-right font-semibold">Medicine</th>
                <th className="py-2 pl-4 font-semibold">Paid by</th>
                <th className="py-2 pr-4 font-semibold">Cashier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.slice(0, shown).map((s) => {
                const isOpen = open === s.visit.id;
                return (
                  <Fragment key={s.visit.id}>
                    <tr
                      className="cursor-pointer hover:bg-teal-50/40"
                      onClick={() => setOpen(isOpen ? null : s.visit.id)}
                      aria-expanded={isOpen}
                    >
                      <td className="whitespace-nowrap py-2.5 pl-4 text-xs text-zinc-500">{exportDateTime(s.at)}</td>
                      <td className="py-2.5">
                        <SourceBadge walkIn={s.walkIn} />
                      </td>
                      <td className="py-2.5">
                        <span className="font-medium text-zinc-900">{s.customer}</span>
                        {s.mrn && <span className="ml-1.5 font-mono text-[10px] text-zinc-400">{s.mrn}</span>}
                      </td>
                      <td className="max-w-xs truncate py-2.5 text-xs text-zinc-600">
                        {s.items.length === 1
                          ? `${s.items[0].name} × ${s.items[0].quantity}`
                          : `${s.items.length} items · ${s.units} units`}
                      </td>
                      <td className="py-2.5 text-right font-semibold tabular-nums">{money(s.medicineTotal)}</td>
                      <td className="py-2.5 pl-4 text-xs text-zinc-600">
                        {s.method ? METHOD_LABELS[s.method] : "—"}
                        {s.reference && <span className="ml-1 font-mono text-[10px] text-zinc-400">{s.reference}</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-zinc-600">{s.cashier ?? "—"}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-zinc-50/70">
                        <td colSpan={7} className="px-4 py-3">
                          <ul className="space-y-1 text-xs">
                            {s.items.map((i, idx) => (
                              <li key={idx} className="flex max-w-lg justify-between">
                                <span>
                                  {i.name} × {i.quantity} @ {money(i.unitPrice)}
                                </span>
                                <span className="tabular-nums">{money(i.quantity * i.unitPrice)}</span>
                              </li>
                            ))}
                          </ul>
                          {!s.walkIn && s.collected > s.medicineTotal + 0.5 && (
                            <p className="mt-2 text-xs text-zinc-500">
                              Collected at checkout: {money(s.collected)} (includes consultation / tests owed from the visit)
                            </p>
                          )}
                          {s.prescriber && (
                            <p className="mt-2 text-xs text-rose-800">Outside prescription: {s.prescriber}</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-zinc-400">
                    No sales match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > shown && (
          <div className="border-t border-zinc-100 p-3 text-center">
            <Button size="sm" variant="secondary" onClick={() => setShown((n) => n + 100)}>
              Show more ({filtered.length - shown} left)
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function SourceBadge({ walkIn }: { walkIn: boolean }) {
  return walkIn ? (
    <span className="inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-200">
      Walk-in
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200">
      Clinic
    </span>
  );
}

function Summary({
  label,
  count,
  value,
  tone,
}: {
  label: string;
  count: number;
  value: number;
  tone: "teal" | "sky" | "violet";
}) {
  const tones = {
    teal: "border-teal-200 bg-white",
    sky: "border-sky-200 bg-sky-50/50",
    violet: "border-violet-200 bg-violet-50/50",
  };
  return (
    <div className={cn("rounded-2xl border p-4", tones[tone])}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">{money(value)}</p>
      <p className="text-xs text-zinc-500">
        {count} sale{count === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly (readonly [T, string])[];
}) {
  return (
    <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 text-xs font-medium">
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={cn("rounded-md px-2.5 py-1", value === key ? "bg-teal-700 text-white" : "text-zinc-600 hover:bg-zinc-50")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
