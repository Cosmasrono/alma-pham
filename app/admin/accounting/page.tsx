"use client";

// The accountant's page, for admins: record the clinic's running expenses,
// see the cost of medicines sold, and read the resulting profit & loss —
// all computed from the same /api/clinic dataset, filtered by period.

import { useMemo, useState } from "react";
import { PrinterIcon } from "lucide-react";
import { addExpense, deleteExpense, useClinic } from "@/lib/store";
import { paymentsOf } from "@/lib/selectors";
import type { Expense, ExpenseCategory } from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  cn,
  inputClass,
} from "@/components/ui";
import { PREMISES_REG_NO } from "@/lib/brand";

const money = (n: number) =>
  `KSh ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  rent: "Rent",
  salaries: "Salaries",
  utilities: "Utilities",
  supplies: "Supplies",
  equipment: "Equipment",
  other: "Other",
};

const CATEGORY_STYLE: Record<ExpenseCategory, string> = {
  rent: "bg-indigo-50 text-indigo-800 ring-indigo-600/20",
  salaries: "bg-sky-50 text-sky-800 ring-sky-600/20",
  utilities: "bg-amber-50 text-amber-800 ring-amber-600/25",
  supplies: "bg-purple-50 text-purple-800 ring-purple-600/20",
  equipment: "bg-teal-50 text-teal-800 ring-teal-600/25",
  other: "bg-zinc-100 text-zinc-600 ring-zinc-500/20",
};

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

/** Today as "YYYY-MM-DD" for the date input's default. */
function todayInput(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function AccountingPage() {
  const data = useClinic();
  const [period, setPeriod] = useState<Period>("30d");

  const report = useMemo(() => {
    const start = periodStart(period);
    const inPeriod = (iso: string) => new Date(iso).getTime() >= start;

    // Revenue and cost of goods sold, from money taken in the period. Every
    // payment on a visit counts, not just the one that closed it — per-stage
    // patients pay for the consultation and their labs along the way.
    const takings = data.visits
      .flatMap((v) => paymentsOf(v).map((payment) => ({ visit: v, payment })))
      .filter((t) => inPeriod(t.payment.paidAt));
    const paid = [...new Set(takings.map((t) => t.visit))];
    const revenue = takings.reduce((s, t) => s + t.payment.amount, 0);
    let cogs = 0;
    let missingCost = false;
    for (const v of paid) {
      for (const item of v.saleItems ?? []) {
        if (item.unitCost === undefined) missingCost = true;
        else cogs += item.quantity * item.unitCost;
      }
    }

    const expenses = data.expenses
      .filter((e) => inPeriod(e.date))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const byCategory = new Map<ExpenseCategory, number>();
    for (const e of expenses) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
    }

    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - totalExpenses;

    return {
      paidCount: paid.length,
      revenue,
      cogs,
      missingCost,
      expenses,
      totalExpenses,
      byCategory,
      grossProfit,
      netProfit,
    };
  }, [data, period]);

  const profitable = report.netProfit >= 0;

  const periodLabel = PERIODS.find((p) => p.key === period)!.label;

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Accounting"
          subtitle="Record expenses, see the cost of medicines sold, and read the profit & loss."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1 rounded-full border border-zinc-200 bg-white p-1 shadow-sm">
                {PERIODS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setPeriod(p.key)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                      period === p.key
                        ? "bg-teal-700 text-white"
                        : "text-zinc-600 hover:bg-teal-50 hover:text-teal-900",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.print()}
              >
                <PrinterIcon className="size-4" />
                Print report
              </Button>
            </div>
          }
        />
      </div>

      {/* Letterhead shown only on the printed report */}
      <div className="mb-5 hidden border-b border-zinc-300 pb-4 print:block">
        <h1 className="text-xl font-semibold text-zinc-900">
          Amla - Medicare Ltd — Profit &amp; Loss Report
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Premises Reg. No. {PREMISES_REG_NO} · Period: {periodLabel} · Printed{" "}
          {new Date().toLocaleDateString("en-KE", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-700">
            Profit &amp; loss
          </h2>
          <span
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset",
              profitable
                ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                : "bg-red-50 text-red-700 ring-red-600/25",
            )}
          >
            {profitable ? "Net profit" : "Net loss"}{" "}
            {money(Math.abs(report.netProfit))}
            {report.revenue > 0 &&
              ` · ${Math.round((report.netProfit / report.revenue) * 100)}% margin`}
          </span>
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div className="text-sm">
            <PnlLine
              label={`Revenue (${report.paidCount} paid visit${report.paidCount === 1 ? "" : "s"})`}
              amount={report.revenue}
            />
            <PnlLine
              label="Cost of medicines sold"
              amount={-report.cogs}
              muted
            />
            <div className="my-2 border-t border-zinc-200" />
            <PnlLine label="Gross profit" amount={report.grossProfit} bold />
            <PnlLine
              label="Operating expenses"
              amount={-report.totalExpenses}
              muted
            />
            <div className="my-2 border-t border-zinc-200" />
            <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2.5">
              <span className="font-semibold text-zinc-800">
                {profitable ? "Net profit" : "Net loss"}
              </span>
              <span
                className={cn(
                  "text-lg font-bold tabular-nums",
                  profitable ? "text-emerald-700" : "text-red-700",
                )}
              >
                {!profitable && "−"}
                {money(Math.abs(report.netProfit))}
              </span>
            </div>
            {report.missingCost && (
              <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                Some older sales have no recorded cost price, so the cost of
                medicines sold may be understated. Set each medicine&apos;s
                cost price on the Medicines page to make future figures exact.
              </p>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase text-zinc-400">
              Operating expenses by category
            </h3>
            {report.byCategory.size === 0 ? (
              <p className="mt-3 text-sm text-zinc-400">
                No expenses logged in this window — record rent, salaries and
                other running costs below to complete the picture.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {[...report.byCategory.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, amount]) => (
                    <div key={cat} className="flex items-center gap-2 text-xs">
                      <span className="w-20 shrink-0 text-zinc-500">
                        {CATEGORY_LABELS[cat]}
                      </span>
                      <div className="h-4 flex-1 overflow-hidden rounded-full bg-teal-900/5">
                        <div
                          className="h-full rounded-full bg-amber-500"
                          style={{
                            width: `${(amount / Math.max(1, report.totalExpenses)) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right tabular-nums text-zinc-700">
                        {money(amount)}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">
            Expenses this period · {money(report.totalExpenses)}
          </h2>
          {report.expenses.length === 0 ? (
            <EmptyState>
              {data.expenses.length === 0
                ? "No expenses logged yet — record the first one on the right."
                : "No expenses in this period."}
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Expense</th>
                      <th className="px-4 py-2 font-medium">Category</th>
                      <th className="px-4 py-2 text-right font-medium">
                        Amount
                      </th>
                      <th className="px-4 py-2 print:hidden" />
                    </tr>
                  </thead>
                  <tbody>
                    {report.expenses.map((e) => (
                      <ExpenseRow key={e.id} expense={e} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <AddExpenseForm />
      </div>
    </div>
  );
}

/** One line of the P&L statement. Negative amounts render as deductions. */
function PnlLine({
  label,
  amount,
  bold,
  muted,
}: {
  label: string;
  amount: number;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <span
        className={cn(bold ? "font-semibold text-zinc-800" : "text-zinc-600")}
      >
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          bold && "font-semibold",
          muted ? "text-zinc-500" : "text-zinc-800",
        )}
      >
        {amount < 0 && "− "}
        {money(Math.abs(amount))}
      </span>
    </div>
  );
}

function ExpenseRow({ expense }: { expense: Expense }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    await deleteExpense(expense.id);
    setBusy(false);
    setConfirming(false);
  };

  return (
    <tr className="border-t border-zinc-100">
      <td className="whitespace-nowrap px-4 py-2 text-zinc-600">
        {new Date(expense.date).toLocaleDateString("en-KE", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        })}
      </td>
      <td className="px-4 py-2">
        <span className="font-medium text-zinc-800">{expense.description}</span>
        {expense.recordedBy && (
          <p className="text-xs text-zinc-400">by {expense.recordedBy}</p>
        )}
      </td>
      <td className="px-4 py-2">
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
            CATEGORY_STYLE[expense.category],
          )}
        >
          {CATEGORY_LABELS[expense.category]}
        </span>
      </td>
      <td className="px-4 py-2 text-right tabular-nums font-medium">
        {money(expense.amount)}
      </td>
      <td className="px-4 py-2 text-right print:hidden">
        {confirming ? (
          <span className="inline-flex items-center gap-1.5">
            <Button size="sm" variant="danger" onClick={remove} disabled={busy}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            Delete
          </Button>
        )}
      </td>
    </tr>
  );
}

function AddExpenseForm() {
  const empty = {
    description: "",
    category: "supplies" as ExpenseCategory,
    amount: "",
    date: todayInput(),
  };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set =
    (k: keyof typeof form) => (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const err = await addExpense({
      description: form.description,
      category: form.category,
      amount: Number(form.amount),
      date: form.date,
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setForm({ ...empty, date: form.date });
  };

  return (
    <Card className="self-start print:hidden">
      <h2 className="mb-4 text-sm font-semibold text-zinc-700">
        Record expense
      </h2>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Description">
          <input
            className={inputClass}
            value={form.description}
            onChange={set("description")}
            placeholder="e.g. July rent, electricity bill…"
            required
          />
        </Field>
        <Field label="Category">
          <select
            className={inputClass}
            value={form.category}
            onChange={set("category")}
          >
            {(Object.keys(CATEGORY_LABELS) as ExpenseCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount (KSh)">
          <input
            className={inputClass}
            type="number"
            min="1"
            step="0.01"
            value={form.amount}
            onChange={set("amount")}
            placeholder="e.g. 25000"
            required
          />
        </Field>
        <Field label="Date">
          <input
            className={inputClass}
            type="date"
            value={form.date}
            onChange={set("date")}
            max={todayInput()}
            required
          />
        </Field>
        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Add expense"}
        </Button>
      </form>
    </Card>
  );
}
