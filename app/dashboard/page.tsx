"use client";

// The admin dashboard: a live station board on top, then an analytics view of
// the clinic over a chosen period. The date filter sits in one row and scopes
// everything below it, so every number on the page always describes the same
// slice of time.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useClinic } from "@/lib/store";
import { Card, PageHeader, cn, inputClass } from "@/components/ui";
import { BranchOverview } from "@/components/BranchOverview";
import { InventoryActivity } from "@/components/InventoryActivity";
import { BRANCHES_ENABLED } from "@/lib/features";
import {
  BarList,
  ChartCard,
  ColumnChart,
  Funnel,
  Heatmap,
  SERIES_COLORS,
  StackedBar,
  StatTile,
  TrendChart,
  type ChartPoint,
} from "@/components/charts";
import {
  LOCATION_LABELS,
  clinicVisits,
  isWalkIn,
  doctorMap,
  doctorName,
  formatDuration,
  outstandingTotal,
  paymentsOf,
  type VisitLocation,
  visitLocation,
} from "@/lib/selectors";
import {
  bucketIndex,
  bucketUnitFor,
  buildBuckets,
  compactMoney,
  money,
  pctChange,
  previousRange,
  rangeLabel,
  resolveRange,
  visitDurationMs,
  type Preset,
  type Range,
} from "@/lib/analytics";
import type {
  Charge,
  ChargeType,
  ClinicData,
  PaymentMethod,
  VisitStatus,
} from "@/lib/types";

const STAGES: { location: VisitLocation; href: string }[] = [
  { location: "reception", href: "/reception" },
  { location: "consultation", href: "/doctor" },
  { location: "lab", href: "/services" },
  { location: "radiology", href: "/services" },
  { location: "procedure", href: "/services" },
  { location: "pharmacy", href: "/pharmacy" },
];

const QUICK_ACTIONS = [
  { href: "/reception", label: "Check in patient", detail: "Find or register a patient" },
  { href: "/flow", label: "View patient flow", detail: "See delays across the clinic" },
  { href: "/admin/reconciliation", label: "Reconcile payments", detail: "Compare cash and M-Pesa" },
  { href: "/admin/medicines", label: "Review stock", detail: "Update medicines and prices" },
];

const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

const CHARGE_LABELS: Record<ChargeType | "unallocated" | "walk-in", string> = {
  consultation: "Consultation",
  lab: "Laboratory",
  radiology: "Radiology",
  procedure: "Procedures",
  pharmacy: "Pharmacy",
  misc: "Sundry",
  unallocated: "Unallocated",
  "walk-in": "Walk-in counter",
};

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  mpesa: "M-Pesa",
  card: "Card",
};

/** The main path a visit walks. Each stage counts the visits that ever reached
 *  it, so the rows read as a funnel rather than as a snapshot. */
const JOURNEY: { label: string; statuses: VisitStatus[] }[] = [
  { label: "Checked in", statuses: [] },
  { label: "Triaged", statuses: ["awaiting-consult-payment", "waiting"] },
  { label: "Seen by a doctor", statuses: ["with-doctor", "back-to-doctor"] },
  { label: "Reached pharmacy", statuses: ["awaiting-pharmacy"] },
  { label: "Visit closed", statuses: ["completed"] },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Axis ticks stay short — "12k" beats "KSh 12,000" under a 2px gridline. */
const moneyAxis = (n: number) =>
  n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));

const countFormat = (n: number) => Math.round(n).toLocaleString("en-KE");

const hourLabel = (h: number) =>
  h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`;

/** Did this visit ever pass through any of these statuses? Old records with no
 *  timeline still count via their current status. */
function reached(
  timeline: { status: VisitStatus }[] | undefined,
  current: VisitStatus,
  statuses: VisitStatus[],
): boolean {
  if (statuses.length === 0) return true;
  if (statuses.includes(current)) return true;
  return (timeline ?? []).some((e) => statuses.includes(e.status));
}

/** Revenue, visits and durations for one window — computed the same way for the
 *  selected period and for the one before it, so the deltas compare like with
 *  like. */
function summarise(data: ClinicData, { from, to }: Range) {
  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= from && t < to;
  };

  const takings = data.visits.flatMap((visit) =>
    paymentsOf(visit)
      .filter((payment) => inRange(payment.paidAt))
      .map((payment) => ({ visit, payment })),
  );
  const revenue = takings.reduce((sum, t) => sum + t.payment.amount, 0);
  // Walk-in counter sales are in revenue above, but they aren't patient
  // visits — counting them would inflate visits and shrink the average time.
  const visits = clinicVisits(data).filter((v) => inRange(v.createdAt));
  const completed = visits.filter((v) => v.status === "completed");
  const durations = completed
    .map(visitDurationMs)
    .filter((ms): ms is number => ms !== null);
  const avgDuration = durations.length
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : null;
  const outstanding = visits.reduce((sum, v) => sum + outstandingTotal(v), 0);

  return { takings, revenue, visits, completed, avgDuration, outstanding };
}

export default function Dashboard() {
  const data = useClinic();
  const [preset, setPreset] = useState<Preset>("30d");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");

  const range = useMemo(
    () => resolveRange(preset, fromInput, toInput),
    [preset, fromInput, toInput],
  );

  // With several branches, say whose figures the detailed section shows.
  const openBranches = data.branches.filter((b) => b.active);
  const viewingLabel =
    !BRANCHES_ENABLED || openBranches.length < 2
      ? null
      : data.viewBranchId
        ? `${data.branches.find((b) => b.id === data.viewBranchId)?.name ?? "This branch"} in detail`
        : "All branches combined";

  // The live board is deliberately outside the date filter — it answers "who is
  // in the building right now", which no period can change.
  const liveCounts = useMemo(() => {
    const counts = new Map<VisitLocation, number>();
    for (const v of clinicVisits(data)) {
      const loc = visitLocation(data, v);
      counts.set(loc, (counts.get(loc) ?? 0) + 1);
    }
    return counts;
  }, [data]);

  const view = useMemo(() => {
    const current = summarise(data, range);
    // "All time" has no window before it to compare against.
    const previous =
      preset === "all" ? null : summarise(data, previousRange(range));

    // "All time" starts at the epoch, which would spend every bucket on the
    // decades before the clinic opened — plot from the first real check-in.
    const earliest = data.visits.reduce(
      (min, v) => Math.min(min, new Date(v.createdAt).getTime()),
      Number.POSITIVE_INFINITY,
    );
    const plotted =
      Number.isFinite(earliest) && earliest > range.from && earliest < range.to
        ? { from: earliest, to: range.to }
        : range;
    const unit = bucketUnitFor(plotted);
    const buckets = buildBuckets(plotted, unit);
    const trend = buckets.map<ChartPoint>((b) => ({
      label: b.label,
      full: b.full,
      values: { revenue: 0, started: 0, completed: 0 },
    }));
    for (const { payment } of current.takings) {
      const i = bucketIndex(buckets, new Date(payment.paidAt).getTime());
      if (i >= 0) trend[i].values.revenue += payment.amount;
    }
    for (const v of current.visits) {
      const i = bucketIndex(buckets, new Date(v.createdAt).getTime());
      if (i >= 0) trend[i].values.started += 1;
    }
    for (const v of current.completed) {
      const closedAt =
        v.timeline?.find((e) => e.status === "completed")?.at ?? v.updatedAt;
      const i = bucketIndex(buckets, new Date(closedAt).getTime());
      if (i >= 0) trend[i].values.completed += 1;
    }

    // Revenue by department: attribute each payment to the charges it settled;
    // legacy lump payments carry no charge ids, so they land in "unallocated".
    const byDepartment = new Map<string, number>();
    const byMethod = new Map<PaymentMethod, number>();
    for (const { visit, payment } of current.takings) {
      byMethod.set(
        payment.method,
        (byMethod.get(payment.method) ?? 0) + payment.amount,
      );
      // Counter sales get their own line rather than hiding inside "Pharmacy".
      if (isWalkIn(visit)) {
        byDepartment.set("walk-in", (byDepartment.get("walk-in") ?? 0) + payment.amount);
        continue;
      }
      const charges = new Map<string, Charge>(
        (visit.charges ?? []).map((c) => [c.id, c]),
      );
      const covered = payment.covers
        .map((id) => charges.get(id))
        .filter((c): c is Charge => Boolean(c));
      if (covered.length === 0) {
        byDepartment.set(
          "unallocated",
          (byDepartment.get("unallocated") ?? 0) + payment.amount,
        );
        continue;
      }
      for (const c of covered) {
        byDepartment.set(c.type, (byDepartment.get(c.type) ?? 0) + c.amount);
      }
    }
    const departments = [...byDepartment.entries()]
      .map(([key, value]) => ({
        label: CHARGE_LABELS[key as keyof typeof CHARGE_LABELS] ?? key,
        value,
      }))
      .sort((a, b) => b.value - a.value);

    const methods = (["cash", "mpesa", "card"] as PaymentMethod[]).map(
      (m, i) => ({
        label: METHOD_LABELS[m],
        value: byMethod.get(m) ?? 0,
        color: SERIES_COLORS[i],
      }),
    );

    // A visit is counted at every stage up to the furthest one it reached:
    // arriving at the pharmacy means it was triaged, whatever its timeline
    // records. Counting each stage independently lets a patchy old timeline
    // report more consultations than triages — a funnel that widens as it
    // descends, which reads as a bug rather than as data.
    const stageTally = new Array(JOURNEY.length).fill(0);
    for (const v of current.visits) {
      let furthest = 0;
      for (let i = 1; i < JOURNEY.length; i++) {
        if (reached(v.timeline, v.status, JOURNEY[i].statuses)) furthest = i;
      }
      for (let i = 0; i <= furthest; i++) stageTally[i] += 1;
    }
    const journey = JOURNEY.map((stage, i) => ({
      label: stage.label,
      value: stageTally[i],
    }));

    // Doctor workload — the unassigned queue is a real row, not a gap.
    const doctors = doctorMap(data);
    const perDoctor = new Map<string, { visits: number; completed: number }>();
    for (const v of current.visits) {
      const id = v.assignedDoctorId ?? "unassigned";
      const entry = perDoctor.get(id) ?? { visits: 0, completed: 0 };
      entry.visits += 1;
      if (v.status === "completed") entry.completed += 1;
      perDoctor.set(id, entry);
    }
    const doctorLoad = [...perDoctor.entries()]
      .map(([id, e]) => ({
        label: id === "unassigned" ? "Unassigned" : doctorName(doctors.get(id)),
        value: e.visits,
        meta: `${e.completed} closed`,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    // Top medicines by what the pharmacy actually sold in these visits.
    const perMedicine = new Map<string, { revenue: number; qty: number }>();
    for (const v of current.visits) {
      for (const item of v.saleItems ?? []) {
        const entry = perMedicine.get(item.name) ?? { revenue: 0, qty: 0 };
        entry.revenue += item.unitPrice * item.quantity;
        entry.qty += item.quantity;
        perMedicine.set(item.name, entry);
      }
    }
    const medicines = [...perMedicine.entries()]
      .map(([label, e]) => ({ label, value: e.revenue, meta: `${e.qty} sold` }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    // Arrivals by weekday and hour — where the day actually gets busy.
    const arrivals = WEEKDAYS.map(() => new Map<number, number>());
    let minHour = 8;
    let maxHour = 17;
    for (const v of current.visits) {
      const at = new Date(v.createdAt);
      const row = (at.getDay() + 6) % 7; // Monday-first
      const hour = at.getHours();
      minHour = Math.min(minHour, hour);
      maxHour = Math.max(maxHour, hour);
      arrivals[row].set(hour, (arrivals[row].get(hour) ?? 0) + 1);
    }
    const hours = Array.from(
      { length: maxHour - minHour + 1 },
      (_, i) => minHour + i,
    );
    const heatRows = WEEKDAYS.map((label, i) => ({
      label,
      values: hours.map((h) => arrivals[i].get(h) ?? 0),
    }));

    return {
      current,
      previous,
      unit,
      trend,
      departments,
      methods,
      journey,
      doctorLoad,
      medicines,
      hours,
      heatRows,
    };
  }, [data, range, preset]);

  const { current, previous, trend } = view;
  const unitLabel =
    view.unit === "day" ? "day" : view.unit === "week" ? "week" : "month";
  const comparison = previous
    ? `vs previous ${PRESETS.find((p) => p.key === preset)?.label.toLowerCase() ?? "period"}`
    : undefined;
  const trendTail = trend.slice(-12);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live overview of every patient in the building, and how the clinic is performing"
      />

      {/* --- live board (never filtered) ------------------------------------ */}
      <section aria-labelledby="live-title">
        <div className="mb-2 flex items-center gap-2">
          <span
            aria-hidden
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-600"
          />
          <h2 id="live-title" className="text-sm font-semibold text-teal-950">
            Right now
          </h2>
          <span className="text-xs text-zinc-400">
            {data.visits.filter((v) => v.status !== "completed").length} patients in
            the building
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {STAGES.map((s) => (
            <Link key={s.location} href={s.href}>
              <Card className="transition-colors hover:border-teal-400">
                <p className="text-3xl font-semibold text-zinc-900">
                  {liveCounts.get(s.location) ?? 0}
                </p>
                <p className="mt-1 text-xs font-medium text-zinc-500">
                  {LOCATION_LABELS[s.location]}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* --- one filter row, scoping everything below ----------------------- */}
      <section
        aria-labelledby="period-title"
        className="mt-8 flex flex-wrap items-center gap-3 border-t border-teal-950/[0.07] pt-5"
      >
        <h2 id="period-title" className="text-sm font-semibold text-teal-950">
          Performance
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              aria-pressed={preset === p.key}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                preset === p.key
                  ? "bg-teal-700 text-white shadow-sm"
                  : "border border-zinc-200 bg-white text-zinc-600 hover:border-teal-700/30 hover:text-teal-900",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="From date"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              className={cn(inputClass, "h-8 text-xs")}
            />
            <span className="text-xs text-zinc-400">to</span>
            <input
              type="date"
              aria-label="To date"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              className={cn(inputClass, "h-8 text-xs")}
            />
          </div>
        )}
        <p className="ml-auto text-xs text-zinc-400">
          {rangeLabel(preset, range.from, range.to)}
        </p>
      </section>

      {/* --- every branch side by side (same period) ------------------------- */}
      {BRANCHES_ENABLED && (
        <div className="mt-6">
          <BranchOverview range={range} />
        </div>
      )}

      {/* --- inventory security: every stock change, flags, branch movement ---- */}
      <div className="mt-6">
        <InventoryActivity range={range} />
      </div>

      {viewingLabel && (
        <h2 className="mt-2 font-display text-lg font-semibold text-teal-950">{viewingLabel}</h2>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Revenue collected"
          value={compactMoney(current.revenue)}
          delta={previous ? pctChange(current.revenue, previous.revenue) : null}
          hint={comparison}
          trend={trendTail.map((p) => p.values.revenue)}
        />
        <StatTile
          label="Visits"
          value={countFormat(current.visits.length)}
          delta={
            previous ? pctChange(current.visits.length, previous.visits.length) : null
          }
          hint={comparison}
          trend={trendTail.map((p) => p.values.started)}
          color={SERIES_COLORS[2]}
        />
        <StatTile
          label="Average time in clinic"
          value={
            current.avgDuration === null ? "—" : formatDuration(current.avgDuration)
          }
          delta={
            previous && current.avgDuration !== null && previous.avgDuration !== null
              ? pctChange(current.avgDuration, previous.avgDuration)
              : null
          }
          goodWhenUp={false}
          hint={
            current.completed.length
              ? `across ${current.completed.length} closed visits`
              : "no visits closed yet"
          }
        />
        <StatTile
          label="Unpaid balance"
          value={compactMoney(current.outstanding)}
          delta={
            previous ? pctChange(current.outstanding, previous.outstanding) : null
          }
          goodWhenUp={false}
          hint="on visits started in this period"
          color={SERIES_COLORS[1]}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Revenue collected"
          subtitle={`KSh per ${unitLabel} · ${rangeLabel(preset, range.from, range.to)}`}
          className="lg:col-span-2"
          table={{
            columns: ["Period", "Revenue (KSh)"],
            rows: trend.map((p) => [p.full ?? p.label, Math.round(p.values.revenue)]),
          }}
        >
          <TrendChart
            points={trend}
            series={[{ key: "revenue", label: "Revenue", color: SERIES_COLORS[0] }]}
            format={money}
            formatAxis={moneyAxis}
          />
        </ChartCard>

        <ChartCard
          title="How patients paid"
          subtitle="Share of collections by method"
          table={{
            columns: ["Method", "Collected (KSh)"],
            rows: view.methods.map((m) => [m.label, Math.round(m.value)]),
          }}
        >
          <StackedBar
            segments={view.methods}
            format={money}
            emptyLabel="No payments in this period."
          />
        </ChartCard>

        <ChartCard
          title="Visits opened and closed"
          subtitle={`Per ${unitLabel} — a widening gap means patients are stacking up`}
          className="lg:col-span-2"
          table={{
            columns: ["Period", "Opened", "Closed"],
            rows: trend.map((p) => [
              p.full ?? p.label,
              p.values.started,
              p.values.completed,
            ]),
          }}
        >
          <ColumnChart
            points={trend}
            series={[
              { key: "started", label: "Opened", color: SERIES_COLORS[0] },
              { key: "completed", label: "Closed", color: SERIES_COLORS[1] },
            ]}
            format={countFormat}
            formatAxis={countFormat}
            integerAxis
          />
        </ChartCard>

        <ChartCard
          title="Patient journey"
          subtitle="Visits that reached each stage"
          table={{
            columns: ["Stage", "Visits"],
            rows: view.journey.map((s) => [s.label, s.value]),
          }}
        >
          <Funnel stages={view.journey} format={countFormat} />
        </ChartCard>

        <ChartCard
          title="Revenue by department"
          subtitle="Settled charges, KSh"
          table={{
            columns: ["Department", "Revenue (KSh)"],
            rows: view.departments.map((d) => [d.label, Math.round(d.value)]),
          }}
        >
          <BarList items={view.departments} format={money} />
        </ChartCard>

        <ChartCard
          title="Doctor workload"
          subtitle="Visits assigned in this period"
          table={{
            columns: ["Doctor", "Visits", "Closed"],
            rows: view.doctorLoad.map((d) => [
              d.label,
              d.value,
              d.meta?.replace(" closed", "") ?? 0,
            ]),
          }}
        >
          <BarList
            items={view.doctorLoad}
            format={countFormat}
            color={SERIES_COLORS[2]}
          />
        </ChartCard>

        <ChartCard
          title="Top medicines"
          subtitle="By pharmacy revenue, KSh"
          table={{
            columns: ["Medicine", "Revenue (KSh)", "Units"],
            rows: view.medicines.map((m) => [
              m.label,
              Math.round(m.value),
              m.meta?.replace(" sold", "") ?? 0,
            ]),
          }}
        >
          <BarList
            items={view.medicines}
            format={money}
            color={SERIES_COLORS[1]}
          />
        </ChartCard>

        <ChartCard
          title="When patients arrive"
          subtitle="Check-ins by weekday and hour — darker is busier"
          className="lg:col-span-3"
          table={{
            columns: ["Day", ...view.hours.map(hourLabel)],
            rows: view.heatRows.map((r) => [r.label, ...r.values]),
          }}
        >
          <Heatmap
            columns={view.hours.map(hourLabel)}
            rows={view.heatRows}
            format={countFormat}
            unitLabel="check-ins"
          />
        </ChartCard>
      </div>

      <section className="mt-8" aria-labelledby="quick-actions-title">
        <h2
          id="quick-actions-title"
          className="mb-3 text-sm font-semibold text-teal-950"
        >
          Common tasks
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="group rounded-2xl border border-teal-950/[0.07] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-600/30 hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-teal-950">{action.label}</p>
                <span
                  aria-hidden
                  className="text-teal-600 transition-transform group-hover:translate-x-1"
                >
                  →
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-500">{action.detail}</p>
            </Link>
          ))}
        </div>
      </section>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-700">
          How a patient flows
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          Reception registers the patient, routes them to a doctor, then takes
          vitals and sets priority → Doctor consults and may order{" "}
          <strong>lab, radiology or procedures</strong> → patient returns to the
          doctor with results → doctor prescribes → Pharmacy dispenses and closes
          the visit. Each number in <strong>Right now</strong> is a live queue —
          click to jump to that station.
        </p>
      </Card>
    </div>
  );
}
