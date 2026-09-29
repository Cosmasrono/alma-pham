"use client";

// Admin reports: Executive analytics, revenue, visit throughput, doctor productivity,
// order fulfillment, pharmacy margins, and inventory snapshot.
// All metrics computed from /api/clinic data filtered by period.

import { useMemo, useState, type ReactNode } from "react";
import {
  DownloadIcon,
  PrinterIcon,
  TrendingUpIcon,
  UsersIcon,
  ActivityIcon,
  ClockIcon,
  CalendarIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  AlertTriangleIcon,
  PillIcon,
  StethoscopeIcon,
  FileTextIcon,
  SearchIcon,
  ArrowUpRightIcon,
  BarChart3Icon,
  PieChartIcon,
  CreditCardIcon,
  SmartphoneIcon,
  WalletIcon,
  SparklesIcon,
  ChevronDownIcon,
  CheckIcon,
  FilterIcon,
  Building2Icon,
  PackageCheckIcon,
  FlameIcon,
} from "lucide-react";
import { useClinic } from "@/lib/store";
import {
  Button,
  Card,
  EmptyState,
  cn,
  inputClass,
} from "@/components/ui";
import {
  doctorMap,
  doctorName,
  formatDuration,
  outstandingTotal,
  clinicVisits,
  isWalkIn,
  patientMap,
  payerName,
  paymentsOf,
  SALE_SOURCE_LABELS,
  type SaleSource,
  saleSource,
} from "@/lib/selectors";
import {
  downloadCsv,
  exportDate,
  exportDateTime,
  fileStamp,
  section,
  sectionsToCsv,
  type Column,
  type CsvSection,
} from "@/lib/export";
import type {
  Charge,
  ChargeType,
  OrderType,
  PaymentMethod,
  Visit,
} from "@/lib/types";
import {
  DAY_MS,
  money,
  rangeLabel,
  resolveRange,
  visitDurationMs,
  type Preset,
} from "@/lib/analytics";
import { PREMISES_REG_NO } from "@/lib/brand";

type ReportTab = "overview" | "financials" | "clinical" | "pharmacy" | "debtors";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 Days" },
  { key: "30d", label: "Last 30 Days" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
  { key: "custom", label: "Custom Range" },
];

const TABS: { key: ReportTab; label: string; icon: typeof BarChart3Icon; badge?: string }[] = [
  { key: "overview", label: "Executive Overview", icon: BarChart3Icon },
  { key: "financials", label: "Financials & Revenue", icon: TrendingUpIcon },
  { key: "clinical", label: "Clinical & Workload", icon: StethoscopeIcon },
  { key: "pharmacy", label: "Pharmacy & Stock", icon: PillIcon },
  { key: "debtors", label: "Debtors & Credit", icon: AlertCircleIcon },
];

const METHOD_META: Record<
  PaymentMethod,
  { label: string; icon: typeof CreditCardIcon; color: string; bg: string }
> = {
  mpesa: {
    label: "M-Pesa",
    icon: SmartphoneIcon,
    color: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-200",
  },
  cash: {
    label: "Cash",
    icon: WalletIcon,
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-200",
  },
  card: {
    label: "Card",
    icon: CreditCardIcon,
    color: "text-blue-700",
    bg: "bg-blue-50 border-blue-200",
  },
};

const ORDER_LABELS: Record<OrderType, string> = {
  lab: "Laboratory Tests",
  radiology: "Radiology & Imaging",
  procedure: "Clinical Procedures",
  prescription: "Prescriptions",
};

const CHARGE_LABELS: Record<ChargeType, string> = {
  consultation: "Doctor Consultation",
  lab: "Laboratory",
  radiology: "Radiology & Imaging",
  procedure: "Medical Procedures",
  pharmacy: "Pharmacy & Medication",
  misc: "Sundry / Miscellaneous",
};

const CHARGE_COLORS: Record<string, { bar: string; text: string; bg: string }> = {
  consultation: { bar: "bg-teal-600", text: "text-teal-700", bg: "bg-teal-50" },
  lab: { bar: "bg-purple-600", text: "text-purple-700", bg: "bg-purple-50" },
  radiology: { bar: "bg-indigo-600", text: "text-indigo-700", bg: "bg-indigo-50" },
  procedure: { bar: "bg-rose-500", text: "text-rose-700", bg: "bg-rose-50" },
  pharmacy: { bar: "bg-emerald-600", text: "text-emerald-700", bg: "bg-emerald-50" },
  misc: { bar: "bg-zinc-500", text: "text-zinc-700", bg: "bg-zinc-50" },
  unallocated: { bar: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" },
};

const num = (n: number) => Math.round(n * 100) / 100;

export default function ReportsPage() {
  const data = useClinic();
  const [preset, setPreset] = useState<Preset>("7d");
  const [activeTab, setActiveTab] = useState<ReportTab>("overview");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeHoverBar, setActiveHoverBar] = useState<number | null>(null);

  const [doctorSearch, setDoctorSearch] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [medSearch, setMedSearch] = useState("");
  const [debtorSearch, setDebtorSearch] = useState("");
  const [takingsSearch, setTakingsSearch] = useState("");
  const [takingsSource, setTakingsSource] = useState<SaleSource | "all">("all");

  const { from, to } = useMemo(
    () => resolveRange(preset, fromInput, toInput),
    [preset, fromInput, toInput],
  );

  const report = useMemo(() => {
    const inRange = (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= from && t < to;
    };

    const patients = patientMap(data);
    const doctors = doctorMap(data);
    const nameOf = (visit: Visit) => payerName(patients, visit);

    // Clinic visits only: walk-in counter sales are revenue, not visits.
    const visits = clinicVisits(data).filter((v) => inRange(v.createdAt));
    const completed = visits.filter((v) => v.status === "completed");

    const takings = data.visits
      .flatMap((v) => paymentsOf(v).map((payment) => ({ visit: v, payment })))
      .filter((t) => inRange(t.payment.paidAt))
      .sort(
        (a, b) =>
          new Date(b.payment.paidAt).getTime() -
          new Date(a.payment.paidAt).getTime(),
      );
    const revenue = takings.reduce((sum, t) => sum + t.payment.amount, 0);
    const walkInTakings = takings.filter((t) => isWalkIn(t.visit));
    const walkInRevenue = walkInTakings.reduce((sum, t) => sum + t.payment.amount, 0);
    // Revenue per visit is about clinic visits, so counter sales stay out of it.
    const paid = [...new Set(takings.filter((t) => !isWalkIn(t.visit)).map((t) => t.visit))];

    const byMethod = new Map<PaymentMethod, { count: number; amount: number }>();
    for (const { payment } of takings) {
      const entry = byMethod.get(payment.method) ?? { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += payment.amount;
      byMethod.set(payment.method, entry);
    }

    const byLine = new Map<string, { count: number; amount: number }>();
    const bump = (key: string, amount: number) => {
      const e = byLine.get(key) ?? { count: 0, amount: 0 };
      e.count += 1;
      e.amount += amount;
      byLine.set(key, e);
    };
    for (const { visit, payment } of takings) {
      const charges = new Map<string, Charge>(
        (visit.charges ?? []).map((c) => [c.id, c]),
      );
      const covered = payment.covers
        .map((id) => charges.get(id))
        .filter((c): c is Charge => Boolean(c));
      if (covered.length === 0) {
        bump("unallocated", payment.amount);
        continue;
      }
      for (const c of covered) bump(c.type, c.amount);
    }

    const barFrom = Math.max(from, to - 30 * DAY_MS);
    const daily: {
      label: string;
      fullDate: string;
      iso: string;
      amount: number;
      visits: number;
      paymentsCount: number;
    }[] = [];
    for (let d = barFrom; d < to; d += DAY_MS) {
      const cursor = new Date(d);
      const start = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate(),
      ).getTime();
      const end = start + DAY_MS;
      let amount = 0;
      let paymentsCount = 0;
      for (const { payment } of takings) {
        const at = new Date(payment.paidAt).getTime();
        if (at >= start && at < end) {
          amount += payment.amount;
          paymentsCount += 1;
        }
      }
      const dayVisits = visits.filter((v) => {
        const at = new Date(v.createdAt).getTime();
        return at >= start && at < end;
      }).length;

      daily.push({
        label: new Date(start).toLocaleDateString("en-KE", {
          day: "numeric",
          month: "short",
        }),
        fullDate: new Date(start).toLocaleDateString("en-KE", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
        iso: new Date(start).toISOString(),
        amount,
        visits: dayVisits,
        paymentsCount,
      });
    }

    const durations = completed
      .map(visitDurationMs)
      .filter((ms): ms is number => ms !== null);
    const avgDuration =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : null;

    const orders = data.orders.filter((o) => inRange(o.createdAt));
    const completedOrdersCount = orders.filter((o) => o.status === "completed").length;
    const byOrderType = new Map<OrderType, { total: number; completed: number }>();
    for (const o of orders) {
      const curr = byOrderType.get(o.type as OrderType) ?? { total: 0, completed: 0 };
      curr.total += 1;
      if (o.status === "completed") curr.completed += 1;
      byOrderType.set(o.type as OrderType, curr);
    }

    const serviceUse = new Map<
      string,
      {
        title: string;
        type: OrderType;
        ordered: number;
        completed: number;
        revenue: number;
      }
    >();
    const priceOf = new Map(data.serviceCatalog.map((s) => [s.id, s.price]));
    for (const o of orders) {
      if (o.type === "prescription") continue;
      const key = `${o.type}:${o.title}`;
      const entry = serviceUse.get(key) ?? {
        title: o.title,
        type: o.type as OrderType,
        ordered: 0,
        completed: 0,
        revenue: 0,
      };
      entry.ordered += 1;
      if (o.status === "completed") entry.completed += 1;
      entry.revenue += o.serviceItemId ? (priceOf.get(o.serviceItemId) ?? 0) : 0;
      serviceUse.set(key, entry);
    }
    const services = [...serviceUse.values()].sort(
      (a, b) => b.ordered - a.ordered,
    );

    const perDoctor = new Map<
      string,
      {
        id: string;
        name: string;
        visits: number;
        completed: number;
        durations: number[];
        revenue: number;
      }
    >();
    for (const v of visits) {
      const id = v.assignedDoctorId ?? "unassigned";
      const entry = perDoctor.get(id) ?? {
        id,
        name:
          id === "unassigned"
            ? "Unassigned Queue"
            : doctorName(doctors.get(id)) || "Dr. Staff",
        visits: 0,
        completed: 0,
        durations: [] as number[],
        revenue: 0,
      };
      entry.visits += 1;
      if (v.status === "completed") entry.completed += 1;
      const ms = visitDurationMs(v);
      if (ms !== null) entry.durations.push(ms);
      entry.revenue += (v.charges ?? [])
        .filter((c) => c.paid)
        .reduce((s, c) => s + c.amount, 0);
      perDoctor.set(id, entry);
    }
    const doctorRows = [...perDoctor.values()]
      .map((d) => ({
        ...d,
        avgMs:
          d.durations.length > 0
            ? d.durations.reduce((a, b) => a + b, 0) / d.durations.length
            : null,
      }))
      .sort((a, b) => b.visits - a.visits);

    const sales = new Map<
      string,
      { id: string; name: string; qty: number; amount: number; cost: number }
    >();
    for (const v of paid) {
      for (const item of v.saleItems ?? []) {
        const entry = sales.get(item.medicineId) ?? {
          id: item.medicineId,
          name: item.name,
          qty: 0,
          amount: 0,
          cost: 0,
        };
        entry.qty += item.quantity;
        entry.amount += item.quantity * item.unitPrice;
        entry.cost += item.quantity * (item.unitCost ?? 0);
        sales.set(item.medicineId, entry);
      }
    }
    const medicines = [...sales.values()].sort((a, b) => b.amount - a.amount);
    const pharmacyRevenue = medicines.reduce((s, m) => s + m.amount, 0);
    const pharmacyCost = medicines.reduce((s, m) => s + m.cost, 0);
    const pharmacyMargin = pharmacyRevenue - pharmacyCost;
    const pharmacyMarginPct =
      pharmacyRevenue > 0 ? (pharmacyMargin / pharmacyRevenue) * 100 : 0;

    const stock = [...data.medicines].sort((a, b) => a.stock - b.stock);
    const outOfStock = stock.filter((m) => m.stock === 0);
    const lowStock = stock.filter((m) => m.stock > 0 && m.stock <= 10);
    const healthyStock = stock.filter((m) => m.stock > 10);
    const stockValueCost = stock.reduce((s, m) => s + m.stock * m.costPrice, 0);
    const stockValueRetail = stock.reduce(
      (s, m) => s + m.stock * m.unitPrice,
      0,
    );

    const debtors = data.visits
      .map((v) => ({ visit: v, owed: outstandingTotal(v) }))
      .filter((d) => d.owed > 0)
      .sort((a, b) => b.owed - a.owed);
    const outstanding = debtors.reduce((s, d) => s + d.owed, 0);

    const newPatients = data.patients.filter((p) => inRange(p.createdAt));

    const totalPotentialBilling = revenue + outstanding;
    const collectionRate =
      totalPotentialBilling > 0 ? (revenue / totalPotentialBilling) * 100 : 100;
    const avgRevenuePerVisit =
      paid.length > 0 ? (revenue - walkInRevenue) / paid.length : 0;
    const visitCompletionRate =
      visits.length > 0 ? (completed.length / visits.length) * 100 : 0;

    return {
      nameOf,
      patients,
      doctors,
      revenue,
      paidVisits: paid.length,
      walkInCount: walkInTakings.length,
      walkInRevenue,
      takings,
      byMethod,
      byLine,
      daily,
      visits,
      completedCount: completed.length,
      avgDuration,
      orders,
      completedOrdersCount,
      byOrderType,
      services,
      doctorRows,
      medicines,
      pharmacyRevenue,
      pharmacyCost,
      pharmacyMargin,
      pharmacyMarginPct,
      stock,
      outOfStock,
      lowStock,
      healthyStock,
      stockValueCost,
      stockValueRetail,
      debtors,
      outstanding,
      newPatients,
      collectionRate,
      avgRevenuePerVisit,
      visitCompletionRate,
    };
  }, [data, from, to]);

  const maxDaily = Math.max(1, ...report.daily.map((d) => d.amount));
  const maxDailyVisits = Math.max(1, ...report.daily.map((d) => d.visits));
  const label = rangeLabel(preset, from, to);

  const visitById = useMemo(
    () => new Map(data.visits.map((v) => [v.id, v])),
    [data.visits],
  );

  const filteredDoctors = useMemo(() => {
    if (!doctorSearch.trim()) return report.doctorRows;
    const q = doctorSearch.toLowerCase();
    return report.doctorRows.filter((d) => d.name.toLowerCase().includes(q));
  }, [report.doctorRows, doctorSearch]);

  const filteredServices = useMemo(() => {
    if (!serviceSearch.trim()) return report.services;
    const q = serviceSearch.toLowerCase();
    return report.services.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        ORDER_LABELS[s.type]?.toLowerCase().includes(q),
    );
  }, [report.services, serviceSearch]);

  const filteredMedicines = useMemo(() => {
    if (!medSearch.trim()) return report.medicines;
    const q = medSearch.toLowerCase();
    return report.medicines.filter((m) => m.name.toLowerCase().includes(q));
  }, [report.medicines, medSearch]);

  const filteredDebtors = useMemo(() => {
    if (!debtorSearch.trim()) return report.debtors;
    const q = debtorSearch.toLowerCase();
    return report.debtors.filter((d) => {
      const name = report.nameOf(d.visit).toLowerCase();
      const mrn = (report.patients.get(d.visit.patientId)?.mrn ?? "").toLowerCase();
      return name.includes(q) || mrn.includes(q);
    });
  }, [report, debtorSearch]);

  const filteredTakings = useMemo(() => {
    const bySource =
      takingsSource === "all"
        ? report.takings
        : report.takings.filter((t) => saleSource(t.visit) === takingsSource);
    if (!takingsSearch.trim()) return bySource;
    const q = takingsSearch.toLowerCase();
    return bySource.filter((t) => {
      const patient = report.nameOf(t.visit).toLowerCase();
      const ref = (t.payment.reference ?? "").toLowerCase();
      const method = t.payment.method.toLowerCase();
      const source = SALE_SOURCE_LABELS[saleSource(t.visit)].toLowerCase();
      return patient.includes(q) || ref.includes(q) || method.includes(q) || source.includes(q);
    });
  }, [report, takingsSearch, takingsSource]);

  const sections = useMemo((): {
    key: string;
    label: string;
    build: () => CsvSection;
  }[] => {
    const { nameOf, patients } = report;
    const cols = <T,>(c: Column<T>[]) => c;

    return [
      {
        key: "summary",
        label: "Executive Summary",
        build: () =>
          section(
            "Executive Summary",
            cols<{ metric: string; value: string | number }>([
              { header: "Metric", value: (r) => r.metric },
              { header: "Value", value: (r) => r.value },
            ]),
            [
              { metric: "Total Revenue Collected (KSh)", value: num(report.revenue) },
              { metric: "Total Payments Processed", value: report.takings.length },
              { metric: "Total Paid Patient Encounters", value: report.paidVisits },
              { metric: "Walk-in Counter Sales", value: report.walkInCount },
              { metric: "Walk-in Counter Revenue (KSh)", value: num(report.walkInRevenue) },
              { metric: "Total Clinic Registrations", value: report.visits.length },
              { metric: "Visits Completed", value: report.completedCount },
              {
                metric: "Average Patient Turnaround",
                value:
                  report.avgDuration !== null
                    ? formatDuration(report.avgDuration)
                    : "N/A",
              },
              { metric: "New Patients Registered", value: report.newPatients.length },
              { metric: "Clinical Orders Raised", value: report.orders.length },
              { metric: "Pharmacy Total Revenue (KSh)", value: num(report.pharmacyRevenue) },
              { metric: "Pharmacy Gross Profit (KSh)", value: num(report.pharmacyMargin) },
              { metric: "Pharmacy Margin (%)", value: `${num(report.pharmacyMarginPct)}%` },
              {
                metric: "Outstanding Patient Debt (KSh)",
                value: num(report.outstanding),
              },
              {
                metric: "Stock Value at Cost (KSh)",
                value: num(report.stockValueCost),
              },
              {
                metric: "Stock Value at Retail (KSh)",
                value: num(report.stockValueRetail),
              },
            ],
          ),
      },
      {
        key: "payments",
        label: "Revenue & Payments Register",
        build: () =>
          section(
            "Payments Register",
            cols<(typeof report.takings)[number]>([
              {
                header: "Paid At",
                value: (r) => exportDateTime(r.payment.paidAt),
              },
              { header: "Date", value: (r) => exportDate(r.payment.paidAt) },
              {
                header: "MRN",
                value: (r) => patients.get(r.visit.patientId)?.mrn ?? "",
              },
              { header: "Patient Name", value: (r) => nameOf(r.visit) },
              { header: "Source", value: (r) => SALE_SOURCE_LABELS[saleSource(r.visit)] },
              { header: "Payment Method", value: (r) => METHOD_META[r.payment.method]?.label ?? r.payment.method },
              { header: "Reference / Transaction Code", value: (r) => r.payment.reference ?? "" },
              { header: "Amount (KSh)", value: (r) => num(r.payment.amount) },
              { header: "Visit ID", value: (r) => r.visit.id },
            ]),
            report.takings,
          ),
      },
      {
        key: "doctors",
        label: "Doctor Productivity & Workload",
        build: () =>
          section(
            "Doctor Productivity",
            cols<(typeof report.doctorRows)[number]>([
              { header: "Doctor Name", value: (r) => r.name },
              { header: "Total Assigned Visits", value: (r) => r.visits },
              { header: "Completed Visits", value: (r) => r.completed },
              {
                header: "Average Duration",
                value: (r) =>
                  r.avgMs !== null ? formatDuration(r.avgMs) : "N/A",
              },
              { header: "Attributed Revenue (KSh)", value: (r) => num(r.revenue) },
            ]),
            report.doctorRows,
          ),
      },
      {
        key: "orders",
        label: "Clinical Orders Register",
        build: () =>
          section(
            "Clinical Orders Register",
            cols<(typeof report.orders)[number]>([
              { header: "Created At", value: (o) => exportDateTime(o.createdAt) },
              { header: "Order Type", value: (o) => ORDER_LABELS[o.type as OrderType] ?? o.type },
              { header: "Test / Item Name", value: (o) => o.title },
              { header: "Status", value: (o) => o.status },
              {
                header: "Completed At",
                value: (o) => (o.completedAt ? exportDateTime(o.completedAt) : ""),
              },
              {
                header: "Turnaround (Minutes)",
                value: (o) =>
                  o.completedAt
                    ? Math.round(
                        (new Date(o.completedAt).getTime() -
                          new Date(o.createdAt).getTime()) /
                          60000,
                      )
                    : "",
              },
              {
                header: "Patient MRN",
                value: (o) => {
                  const v = visitById.get(o.visitId);
                  return v ? (patients.get(v.patientId)?.mrn ?? "") : "";
                },
              },
              {
                header: "Patient Name",
                value: (o) => {
                  const v = visitById.get(o.visitId);
                  return v ? nameOf(v) : "";
                },
              },
              { header: "Visit ID", value: (o) => o.visitId },
            ]),
            report.orders,
          ),
      },
      {
        key: "services",
        label: "Service Utilisation & Revenue",
        build: () =>
          section(
            "Service Utilisation",
            cols<(typeof report.services)[number]>([
              { header: "Service Name", value: (r) => r.title },
              { header: "Department", value: (r) => ORDER_LABELS[r.type] ?? r.type },
              { header: "Quantity Ordered", value: (r) => r.ordered },
              { header: "Quantity Completed", value: (r) => r.completed },
              { header: "Total Value (KSh)", value: (r) => num(r.revenue) },
            ]),
            report.services,
          ),
      },
      {
        key: "pharmacy",
        label: "Pharmacy Sales & Margins",
        build: () =>
          section(
            "Pharmacy Sales & Margins",
            cols<(typeof report.medicines)[number]>([
              { header: "Medicine Name", value: (r) => r.name },
              { header: "Quantity Sold", value: (r) => r.qty },
              { header: "Gross Revenue (KSh)", value: (r) => num(r.amount) },
              { header: "Cost of Goods Sold (KSh)", value: (r) => num(r.cost) },
              { header: "Gross Profit Margin (KSh)", value: (r) => num(r.amount - r.cost) },
              {
                header: "Margin (%)",
                value: (r) =>
                  r.amount > 0
                    ? `${num(((r.amount - r.cost) / r.amount) * 100)}%`
                    : "0%",
              },
            ]),
            report.medicines,
          ),
      },
      {
        key: "stock",
        label: "Current Stock Valuation",
        build: () =>
          section(
            "Current Stock Valuation Snapshot",
            cols<(typeof report.stock)[number]>([
              { header: "Medicine Name", value: (m) => m.name },
              { header: "Strength", value: (m) => m.strength },
              { header: "Form", value: (m) => m.form },
              { header: "Stock on Hand", value: (m) => m.stock },
              { header: "Unit Cost (KSh)", value: (m) => num(m.costPrice) },
              { header: "Unit Retail Price (KSh)", value: (m) => num(m.unitPrice) },
              {
                header: "Valuation at Cost (KSh)",
                value: (m) => num(m.stock * m.costPrice),
              },
              {
                header: "Valuation at Retail (KSh)",
                value: (m) => num(m.stock * m.unitPrice),
              },
              {
                header: "Stock Status",
                value: (m) =>
                  m.stock === 0 ? "Out of Stock" : m.stock <= 10 ? "Low Stock" : "Healthy",
              },
            ]),
            report.stock,
          ),
      },
      {
        key: "debtors",
        label: "Outstanding Debts Ledger",
        build: () =>
          section(
            "Outstanding Patient Balances",
            cols<(typeof report.debtors)[number]>([
              {
                header: "Check-in Date",
                value: (d) => exportDateTime(d.visit.createdAt),
              },
              {
                header: "Patient MRN",
                value: (d) => patients.get(d.visit.patientId)?.mrn ?? "",
              },
              { header: "Patient Name", value: (d) => nameOf(d.visit) },
              {
                header: "Phone Number",
                value: (d) => patients.get(d.visit.patientId)?.phone ?? "",
              },
              { header: "Visit Status", value: (d) => d.visit.status },
              { header: "Outstanding Balance (KSh)", value: (d) => num(d.owed) },
              { header: "Visit Reference", value: (d) => d.visit.id },
            ]),
            report.debtors,
          ),
      },
    ];
  }, [report, visitById]);

  const meta = () => [
    "Amla - Medicare Ltd — Operations & Financial Intelligence Report",
    `Premises Reg. No.: ${PREMISES_REG_NO}`,
    `Reporting Window: ${label}`,
    `Generated By: System Administrator on ${exportDateTime(new Date().toISOString())}`,
    "Confidential & Proprietary Clinical Data",
  ];

  function exportOne(key: string) {
    const entry = sections.find((s) => s.key === key);
    if (!entry) return;
    downloadCsv(
      `amla-medicare-${key}-${fileStamp()}.csv`,
      sectionsToCsv([entry.build()], meta()),
    );
    setMenuOpen(false);
  }

  function exportAll() {
    downloadCsv(
      `amla-medicare-full-executive-report-${fileStamp()}.csv`,
      sectionsToCsv(
        sections.map((s) => s.build()),
        meta(),
      ),
    );
    setMenuOpen(false);
  }

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-800 text-teal-100 shadow-sm shadow-teal-950/20">
                <BarChart3Icon className="size-5" />
              </span>
              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight text-teal-950 sm:text-3xl">
                  Operations & Financial Reports
                </h1>
                <p className="text-xs font-medium text-zinc-500 sm:text-sm">
                  Executive analytics, clinical throughput, doctor productivity & inventory
                </p>
              </div>
            </div>
          </div>

          {/* Top Actions: Export & Print */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-teal-800 px-4 text-xs font-semibold text-white shadow-sm shadow-teal-950/20 transition-all hover:bg-teal-900 active:scale-[0.98]"
              >
                <DownloadIcon className="size-4" />
                <span>Export Data</span>
                <ChevronDownIcon className="size-3.5 opacity-70" />
              </button>

              {menuOpen && (
                <>
                  <button
                    aria-label="Close export menu"
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute right-0 z-50 mt-2 w-72 origin-top-right overflow-hidden rounded-2xl border border-teal-950/10 bg-white p-1.5 shadow-2xl shadow-teal-950/20 animate-in fade-in zoom-in-95">
                    <div className="px-3 py-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-teal-800">
                        CSV Data Export Center
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        Export formatted datasets for spreadsheet analysis
                      </p>
                    </div>

                    <button
                      onClick={exportAll}
                      className="group flex w-full items-center justify-between rounded-xl bg-teal-50/80 px-3 py-2.5 text-left text-xs font-semibold text-teal-900 transition-colors hover:bg-teal-100"
                    >
                      <div className="flex items-center gap-2">
                        <SparklesIcon className="size-4 text-teal-700" />
                        <span>Consolidated Master CSV</span>
                      </div>
                      <span className="rounded-full bg-teal-200/60 px-2 py-0.5 text-[10px] font-medium text-teal-900">
                        All 8 Datasets
                      </span>
                    </button>

                    <div className="my-1.5 border-t border-zinc-100" />

                    <div className="space-y-0.5">
                      {sections.map((s) => (
                        <button
                          key={s.key}
                          onClick={() => exportOne(s.key)}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs text-zinc-700 transition-colors hover:bg-teal-50 hover:text-teal-950"
                        >
                          <span>{s.label}</span>
                          <ArrowUpRightIcon className="size-3 text-zinc-400" />
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.print()}
              className="h-9 gap-2 rounded-xl text-xs font-semibold"
            >
              <PrinterIcon className="size-4 text-zinc-600" />
              Print / PDF
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-teal-950/10 bg-white p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 hidden text-xs font-medium text-zinc-400 sm:inline">
              Period:
            </span>
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={cn(
                  "rounded-xl px-3 py-1.5 text-xs font-medium transition-all",
                  preset === p.key
                    ? "bg-teal-800 text-white shadow-xs font-semibold"
                    : "text-zinc-600 hover:bg-teal-50/70 hover:text-teal-900",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <div className="flex items-center gap-1.5 rounded-xl bg-teal-50/70 px-3 py-1 text-xs font-medium text-teal-900 ring-1 ring-teal-600/15">
              <CalendarIcon className="size-3.5 text-teal-700" />
              <span>{label}</span>
            </div>
          </div>
        </div>

        {preset === "custom" && (
          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-2xl border border-teal-950/10 bg-white p-4 shadow-xs">
            <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-700">
              <span>Start Date</span>
              <input
                type="date"
                value={fromInput}
                max={toInput || undefined}
                onChange={(e) => setFromInput(e.target.value)}
                className={cn(inputClass, "h-9 w-44")}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-700">
              <span>End Date</span>
              <input
                type="date"
                value={toInput}
                min={fromInput || undefined}
                onChange={(e) => setToInput(e.target.value)}
                className={cn(inputClass, "h-9 w-44")}
              />
            </label>
            <p className="pb-2 text-xs text-zinc-400">
              Specify custom start and end dates to filter clinic operations data.
            </p>
          </div>
        )}

        <div className="mt-5 flex gap-1.5 overflow-x-auto border-b border-zinc-200/80 pb-px">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "group inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition-all",
                  isActive
                    ? "border-teal-700 text-teal-950 font-bold"
                    : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 transition-colors",
                    isActive ? "text-teal-700" : "text-zinc-400 group-hover:text-zinc-600",
                  )}
                />
                <span>{tab.label}</span>
                {tab.key === "debtors" && report.debtors.length > 0 && (
                  <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.2 text-[10px] font-bold text-amber-900">
                    {report.debtors.length}
                  </span>
                )}
                {tab.key === "pharmacy" && report.lowStock.length > 0 && (
                  <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.2 text-[10px] font-bold text-red-800">
                    {report.lowStock.length} low
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ----------------- PRINT LETTERHEAD (ONLY IN PRINT MODE) ----------------- */}
      <div className="hidden print:block mb-8 border-b-2 border-teal-900 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-teal-950">Amla - Medicare Ltd</h1>
            <p className="text-sm font-medium text-zinc-600">
              Operations & Financial Intelligence Report
            </p>
            <p className="text-xs text-zinc-600">Premises Reg. No. {PREMISES_REG_NO}</p>
          </div>
          <div className="text-right text-xs text-zinc-600">
            <p className="font-semibold text-zinc-900">Official Executive Summary</p>
            <p>Period: {label}</p>
            <p>Generated: {new Date().toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        </div>
      </div>

      {(activeTab === "overview" || typeof window === "undefined") && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative overflow-hidden rounded-2xl border border-teal-700/20 bg-linear-to-br from-teal-900 to-teal-950 p-4.5 text-white shadow-md shadow-teal-950/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-teal-200/90">
                  Total Revenue
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-800/80 text-teal-200">
                  <TrendingUpIcon className="size-4" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {money(report.revenue)}
              </p>
              <div className="mt-3 flex items-center justify-between border-t border-teal-800/80 pt-2 text-xs text-teal-200/80">
                <span>{report.takings.length} payments taken</span>
                <span className="font-medium text-teal-100">
                  {report.paidVisits} paid visit{report.paidVisits === 1 ? "" : "s"}
                  {report.walkInCount > 0 &&
                    ` · ${report.walkInCount} walk-in sale${report.walkInCount === 1 ? "" : "s"} (${money(report.walkInRevenue)})`}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-teal-950/10 bg-white p-4.5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Patient Encounters
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                  <UsersIcon className="size-4" />
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <p className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
                  {report.visits.length}
                </p>
                <span className="text-xs font-semibold text-emerald-700">
                  {report.completedCount} completed ({Math.round(report.visitCompletionRate)}%)
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-2 text-xs text-zinc-500">
                <span>New: {report.newPatients.length} registered</span>
                <span className="font-medium text-zinc-700">
                  Avg: {report.avgDuration ? formatDuration(report.avgDuration) : "—"}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-teal-950/10 bg-white p-4.5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Clinical Orders
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-700">
                  <ActivityIcon className="size-4" />
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <p className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
                  {report.orders.length}
                </p>
                <span className="text-xs font-semibold text-purple-700">
                  {report.completedOrdersCount} fulfilled
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-2 text-xs text-zinc-500">
                <span>{report.services.length} unique services</span>
                <span className="font-medium text-zinc-700">
                  ARPV: {money(report.avgRevenuePerVisit)}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-900/15 bg-amber-50/40 p-4.5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-amber-800">
                  Outstanding Receivables
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                  <AlertCircleIcon className="size-4" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold tracking-tight text-amber-950 sm:text-3xl">
                {money(report.outstanding)}
              </p>
              <div className="mt-3 flex items-center justify-between border-t border-amber-200/60 pt-2 text-xs text-amber-800">
                <span>{report.debtors.length} unpaid visits</span>
                <span className="font-medium text-amber-950">
                  {Math.round(report.collectionRate)}% collection
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Daily Trend Interactive Bar & Line Chart (2 Cols) */}
            <Card className="p-5 lg:col-span-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-bold text-zinc-900">
                    Daily Revenue & Patient Volume Trend
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Day-by-day cash inflow and patient volume over the active period
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs font-medium">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-teal-600" />
                    <span className="text-zinc-600">Revenue (KSh)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                    <span className="text-zinc-600">Patient Visits</span>
                  </div>
                </div>
              </div>

              {report.daily.every((d) => d.amount === 0 && d.visits === 0) ? (
                <div className="py-12 text-center text-xs text-zinc-400">
                  No clinic revenue or visits recorded in this time range.
                </div>
              ) : (
                <div className="mt-6">
                  <div className="relative flex h-52 items-end gap-1.5 border-b border-zinc-200 pb-2 sm:gap-2">
                    {report.daily.map((d, i) => {
                      const revPct = Math.max(4, (d.amount / maxDaily) * 100);
                      const isHovered = activeHoverBar === i;

                      return (
                        <div
                          key={d.iso}
                          className="group relative flex flex-1 flex-col items-center h-full justify-end"
                          onMouseEnter={() => setActiveHoverBar(i)}
                          onMouseLeave={() => setActiveHoverBar(null)}
                        >
                          {isHovered && (
                            <div className="absolute -top-16 z-30 min-w-36 rounded-xl border border-zinc-200 bg-teal-950 p-2 text-white shadow-xl pointer-events-none animate-in fade-in zoom-in-95">
                              <p className="text-[10px] font-semibold text-teal-300">
                                {d.fullDate}
                              </p>
                              <p className="text-xs font-bold text-white">
                                {money(d.amount)}
                              </p>
                              <p className="text-[10px] text-teal-100/70">
                                {d.visits} visit{d.visits === 1 ? "" : "s"} · {d.paymentsCount} txn{d.paymentsCount === 1 ? "" : "s"}
                              </p>
                            </div>
                          )}

                          <div className="flex w-full items-end justify-center gap-1 h-full">
                            <div
                              className={cn(
                                "w-full max-w-[18px] rounded-t-md transition-all duration-300",
                                isHovered
                                  ? "bg-teal-500 shadow-md shadow-teal-700/30"
                                  : d.amount > 0
                                    ? "bg-teal-700/80 hover:bg-teal-600"
                                    : "bg-zinc-100",
                              )}
                              style={{ height: `${revPct}%` }}
                            />
                          </div>

                          <span className="mt-2 text-[10px] font-medium text-zinc-400 group-hover:text-teal-900">
                            {d.label.split(" ")[0]}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-zinc-700">Peak Day Revenue:</span>
                      <span>
                        {money(maxDaily)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-zinc-700">Daily Average:</span>
                      <span>
                        {money(
                          report.daily.length > 0
                            ? report.revenue / report.daily.length
                            : 0,
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-zinc-700">Encounters Count:</span>
                      <span>{report.visits.length} Total</span>
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* Department Revenue Breakdown (1 Col) */}
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-zinc-900">
                    Revenue by Service Line
                  </h2>
                  <p className="text-xs text-zinc-500">Share of total earnings by clinic station</p>
                </div>
                <PieChartIcon className="size-4 text-zinc-400" />
              </div>

              <div className="mt-4 space-y-3">
                {report.byLine.size === 0 ? (
                  <p className="py-6 text-center text-xs text-zinc-400">
                    No departmental revenue logged in this window.
                  </p>
                ) : (
                  [...report.byLine.entries()]
                    .sort((a, b) => b[1].amount - a[1].amount)
                    .map(([key, v]) => {
                      const pct = report.revenue > 0 ? (v.amount / report.revenue) * 100 : 0;
                      const style = CHARGE_COLORS[key] ?? CHARGE_COLORS.misc;
                      const labelText = CHARGE_LABELS[key as ChargeType] ?? "Unallocated";

                      return (
                        <div key={key} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-zinc-700">{labelText}</span>
                            <span className="font-bold tabular-nums text-zinc-900">
                              {money(v.amount)}{" "}
                              <span className="font-normal text-zinc-400">
                                ({Math.round(pct)}%)
                              </span>
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                            <div
                              className={cn("h-full rounded-full transition-all duration-500", style.bar)}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })
                )}
              </div>

              <div className="mt-6 border-t border-zinc-100 pt-4">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Payment Channels
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(Object.keys(METHOD_META) as PaymentMethod[]).map((m) => {
                    const entry = report.byMethod.get(m);
                    const meta = METHOD_META[m];
                    const Icon = meta.icon;
                    const amount = entry?.amount ?? 0;
                    const pct = report.revenue > 0 ? Math.round((amount / report.revenue) * 100) : 0;

                    return (
                      <div
                        key={m}
                        className={cn("rounded-xl border p-2.5 text-center", meta.bg)}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <Icon className={cn("size-3.5", meta.color)} />
                          <span className={cn("text-xs font-semibold", meta.color)}>
                            {meta.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-bold text-zinc-900">{money(amount)}</p>
                        <p className="text-[10px] text-zinc-500">{pct}% share</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex items-center gap-3.5 rounded-2xl border border-teal-950/10 bg-white p-4 shadow-xs">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-800">
                <StethoscopeIcon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-zinc-500">Top Attributed Doctor</p>
                <p className="truncate text-sm font-bold text-zinc-900">
                  {report.doctorRows[0]?.name ?? "No consultations"}
                </p>
                <p className="text-xs text-teal-700">
                  {report.doctorRows[0]
                    ? `${report.doctorRows[0].visits} visits · ${money(report.doctorRows[0].revenue)}`
                    : "No data"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3.5 rounded-2xl border border-teal-950/10 bg-white p-4 shadow-xs">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-800">
                <FlameIcon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-zinc-500">Top Requested Service</p>
                <p className="truncate text-sm font-bold text-zinc-900">
                  {report.services[0]?.title ?? "No orders recorded"}
                </p>
                <p className="text-xs text-purple-700">
                  {report.services[0]
                    ? `${report.services[0].ordered} orders · ${money(report.services[0].revenue)}`
                    : "No data"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3.5 rounded-2xl border border-red-200 bg-red-50/40 p-4 shadow-xs">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
                <PackageCheckIcon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-red-800">Stock Reorder Alerts</p>
                <p className="text-sm font-bold text-red-950">
                  {report.lowStock.length + report.outOfStock.length} Items Need Attention
                </p>
                <p className="text-xs text-red-700">
                  {report.outOfStock.length} out of stock · {report.lowStock.length} low
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {(activeTab === "financials" || typeof window === "undefined") && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card className="p-4.5">
              <span className="text-xs font-semibold text-zinc-500 uppercase">Gross Revenue Collected</span>
              <p className="mt-1 text-2xl font-bold text-teal-950">{money(report.revenue)}</p>
              <p className="mt-1 text-xs text-zinc-400">Total settled patient invoices</p>
            </Card>
            <Card className="p-4.5">
              <span className="text-xs font-semibold text-zinc-500 uppercase">Average Revenue / Paid Visit</span>
              <p className="mt-1 text-2xl font-bold text-zinc-900">{money(report.avgRevenuePerVisit)}</p>
              <p className="mt-1 text-xs text-zinc-400">Across {report.paidVisits} paid encounters</p>
            </Card>
            <Card className="p-4.5">
              <span className="text-xs font-semibold text-zinc-500 uppercase">Total Potential Billing</span>
              <p className="mt-1 text-2xl font-bold text-zinc-900">{money(report.revenue + report.outstanding)}</p>
              <p className="mt-1 text-xs text-emerald-700 font-medium">{Math.round(report.collectionRate)}% Collection Rate</p>
            </Card>
          </div>

          <Card className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-bold text-zinc-900">
                  Payments & Collections Register
                </h2>
                <p className="text-xs text-zinc-500">
                  Audit log of every transaction received in this reporting period
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {/* Source filter: in-house (clinic) vs community (walk-in) */}
                <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 text-[11px] font-medium">
                  {(
                    [
                      ["all", "All"],
                      ["in-house", "In-house"],
                      ["community", "Community"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setTakingsSource(key)}
                      aria-pressed={takingsSource === key}
                      className={cn(
                        "rounded-md px-2.5 py-1 transition-colors",
                        takingsSource === key
                          ? "bg-teal-700 text-white"
                          : "text-zinc-600 hover:bg-zinc-50",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-64">
                  <SearchIcon className="absolute left-3 top-2.5 size-4 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="Search patient, ref, method..."
                    value={takingsSearch}
                    onChange={(e) => setTakingsSearch(e.target.value)}
                    className={cn(inputClass, "h-9 w-full pl-9 text-xs")}
                  />
                </div>
              </div>
            </div>

            {filteredTakings.length === 0 ? (
              <div className="py-12 text-center text-xs text-zinc-400">
                No matching payments found for this period.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[650px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                      <th className="rounded-l-lg py-2.5 pl-3 font-semibold">Time & Date</th>
                      <th className="py-2.5 font-semibold">Patient</th>
                      <th className="py-2.5 font-semibold">Source</th>
                      <th className="py-2.5 font-semibold">Method</th>
                      <th className="py-2.5 font-semibold">Reference</th>
                      <th className="py-2.5 pr-3 text-right font-semibold rounded-r-lg">Amount (KSh)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredTakings.slice(0, 50).map((t, idx) => {
                      const method = METHOD_META[t.payment.method];
                      const Icon = method?.icon ?? CreditCardIcon;
                      const pat = report.patients.get(t.visit.patientId);

                      return (
                        <tr key={`${t.payment.paidAt}-${idx}`} className="hover:bg-teal-50/40">
                          <td className="py-3 pl-3 tabular-nums text-zinc-600">
                            {exportDateTime(t.payment.paidAt)}
                          </td>
                          <td className="py-3">
                            <span className="font-semibold text-zinc-900">
                              {report.nameOf(t.visit)}
                            </span>
                            {pat?.mrn && (
                              <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500">
                                {pat.mrn}
                              </span>
                            )}
                          </td>
                          <td className="py-3">
                            {saleSource(t.visit) === "community" ? (
                              <span className="inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200">
                                Community
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200">
                                In-house
                              </span>
                            )}
                          </td>
                          <td className="py-3">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                                method?.bg ?? "bg-zinc-100 text-zinc-600",
                              )}
                            >
                              <Icon className="size-3" />
                              {method?.label ?? t.payment.method}
                            </span>
                          </td>
                          <td className="py-3 font-mono text-zinc-500">
                            {t.payment.reference || "—"}
                          </td>
                          <td className="py-3 pr-3 text-right font-bold tabular-nums text-teal-950">
                            {money(t.payment.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {(activeTab === "clinical" || typeof window === "undefined") && (
        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-bold text-zinc-900">
                  Doctor Workload & Productivity
                </h2>
                <p className="text-xs text-zinc-500">
                  Encounter volumes, turnaround speeds, and revenue contributions
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <SearchIcon className="absolute left-3 top-2.5 size-4 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Filter doctor name..."
                  value={doctorSearch}
                  onChange={(e) => setDoctorSearch(e.target.value)}
                  className={cn(inputClass, "h-9 w-full pl-9 text-xs")}
                />
              </div>
            </div>

            {filteredDoctors.length === 0 ? (
              <div className="py-12 text-center text-xs text-zinc-400">
                No doctor records for this period.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[650px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                      <th className="rounded-l-lg py-2.5 pl-3 font-semibold">Doctor</th>
                      <th className="py-2.5 text-center font-semibold">Visits Handled</th>
                      <th className="py-2.5 text-center font-semibold">Completion</th>
                      <th className="py-2.5 font-semibold">Average Turnaround</th>
                      <th className="py-2.5 pr-3 text-right font-semibold rounded-r-lg">
                        Attributed Revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredDoctors.map((doc) => {
                      const compPct =
                        doc.visits > 0 ? Math.round((doc.completed / doc.visits) * 100) : 0;

                      return (
                        <tr key={doc.id} className="hover:bg-teal-50/40">
                          <td className="py-3 pl-3">
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-100 font-bold text-teal-800 text-[11px]">
                                {doc.name.replace(/^(Dr\.\s*)/i, "").slice(0, 2).toUpperCase()}
                              </span>
                              <div>
                                <p className="font-semibold text-zinc-900">{doc.name}</p>
                                <p className="text-[10px] text-zinc-400">General Practice & Consults</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 text-center font-bold tabular-nums text-zinc-900">
                            {doc.visits}
                          </td>
                          <td className="py-3 text-center">
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-600/20">
                              <CheckCircle2Icon className="size-3" />
                              {doc.completed} ({compPct}%)
                            </span>
                          </td>
                          <td className="py-3 tabular-nums text-zinc-600">
                            {doc.avgMs !== null ? formatDuration(doc.avgMs) : "—"}
                          </td>
                          <td className="py-3 pr-3 text-right font-bold tabular-nums text-teal-950">
                            {money(doc.revenue)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-bold text-zinc-900">
                  Clinical Services & Test Utilization
                </h2>
                <p className="text-xs text-zinc-500">
                  Lab tests, radiology exams, and procedures ordered vs completed
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <SearchIcon className="absolute left-3 top-2.5 size-4 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search test or department..."
                  value={serviceSearch}
                  onChange={(e) => setServiceSearch(e.target.value)}
                  className={cn(inputClass, "h-9 w-full pl-9 text-xs")}
                />
              </div>
            </div>

            {filteredServices.length === 0 ? (
              <div className="py-12 text-center text-xs text-zinc-400">
                No services or diagnostic tests logged in this window.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[650px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                      <th className="rounded-l-lg py-2.5 pl-3 font-semibold">Service Name</th>
                      <th className="py-2.5 font-semibold">Department</th>
                      <th className="py-2.5 text-center font-semibold">Ordered</th>
                      <th className="py-2.5 text-center font-semibold">Completed</th>
                      <th className="py-2.5 pr-3 text-right font-semibold rounded-r-lg">
                        Catalog Value (KSh)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredServices.map((s) => (
                      <tr key={`${s.type}:${s.title}`} className="hover:bg-teal-50/40">
                        <td className="py-3 pl-3 font-semibold text-zinc-900">{s.title}</td>
                        <td className="py-3">
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
                            {ORDER_LABELS[s.type]}
                          </span>
                        </td>
                        <td className="py-3 text-center font-bold tabular-nums text-zinc-900">
                          {s.ordered}
                        </td>
                        <td className="py-3 text-center">
                          <span className="font-semibold text-emerald-700 tabular-nums">
                            {s.completed}
                          </span>
                        </td>
                        <td className="py-3 pr-3 text-right font-bold tabular-nums text-teal-950">
                          {money(s.revenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {(activeTab === "pharmacy" || typeof window === "undefined") && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Card className="p-4.5">
              <span className="text-xs font-semibold text-zinc-500 uppercase">Pharmacy Revenue</span>
              <p className="mt-1 text-2xl font-bold text-teal-950">{money(report.pharmacyRevenue)}</p>
              <p className="mt-1 text-xs text-zinc-400">Total medicine checkout value</p>
            </Card>
            <Card className="p-4.5">
              <span className="text-xs font-semibold text-zinc-500 uppercase">Cost of Goods Sold</span>
              <p className="mt-1 text-2xl font-bold text-zinc-900">{money(report.pharmacyCost)}</p>
              <p className="mt-1 text-xs text-zinc-400">Inventory acquisition cost</p>
            </Card>
            <Card className="p-4.5">
              <span className="text-xs font-semibold text-zinc-500 uppercase">Gross Profit Margin</span>
              <p className="mt-1 text-2xl font-bold text-emerald-700">{money(report.pharmacyMargin)}</p>
              <p className="mt-1 text-xs font-semibold text-emerald-800">
                {Math.round(report.pharmacyMarginPct)}% Average Margin
              </p>
            </Card>
            <Card className="p-4.5">
              <span className="text-xs font-semibold text-zinc-500 uppercase">Current Inventory Value</span>
              <p className="mt-1 text-2xl font-bold text-zinc-900">{money(report.stockValueCost)}</p>
              <p className="mt-1 text-xs text-zinc-500">{money(report.stockValueRetail)} at retail</p>
            </Card>
          </div>

          <Card className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-bold text-zinc-900">
                  Pharmacy Sales & Product Performance
                </h2>
                <p className="text-xs text-zinc-500">
                  Quantity dispensed, revenue generated, and realized profit margins
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <SearchIcon className="absolute left-3 top-2.5 size-4 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Filter medicine name..."
                  value={medSearch}
                  onChange={(e) => setMedSearch(e.target.value)}
                  className={cn(inputClass, "h-9 w-full pl-9 text-xs")}
                />
              </div>
            </div>

            {filteredMedicines.length === 0 ? (
              <div className="py-12 text-center text-xs text-zinc-400">
                No pharmacy sales registered in this reporting period.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[650px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                      <th className="rounded-l-lg py-2.5 pl-3 font-semibold">Medicine Product</th>
                      <th className="py-2.5 text-center font-semibold">Units Sold</th>
                      <th className="py-2.5 text-right font-semibold">Total Revenue</th>
                      <th className="py-2.5 text-right font-semibold">Cost of Goods</th>
                      <th className="py-2.5 pr-3 text-right font-semibold rounded-r-lg">
                        Profit Margin
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredMedicines.map((m) => {
                      const margin = m.amount - m.cost;
                      const marginPct = m.amount > 0 ? Math.round((margin / m.amount) * 100) : 0;

                      return (
                        <tr key={m.id} className="hover:bg-teal-50/40">
                          <td className="py-3 pl-3 font-semibold text-zinc-900">{m.name}</td>
                          <td className="py-3 text-center font-bold tabular-nums text-zinc-900">
                            {m.qty}
                          </td>
                          <td className="py-3 text-right font-bold tabular-nums text-zinc-900">
                            {money(m.amount)}
                          </td>
                          <td className="py-3 text-right tabular-nums text-zinc-500">
                            {m.cost > 0 ? money(m.cost) : "—"}
                          </td>
                          <td className="py-3 pr-3 text-right tabular-nums font-bold text-emerald-800">
                            {margin > 0 ? (
                              <span>
                                {money(margin)}{" "}
                                <span className="text-[10px] font-normal text-emerald-600">
                                  ({marginPct}%)
                                </span>
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-zinc-900">
                  Stock Health & Inventory Reorder Alerts
                </h2>
                <p className="text-xs text-zinc-500">
                  Live shelf snapshot — items that are depleted or below the minimum safety threshold (≤ 10 units)
                </p>
              </div>
              <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-800">
                {report.lowStock.length + report.outOfStock.length} Low / Depleted
              </span>
            </div>

            {report.lowStock.length === 0 && report.outOfStock.length === 0 ? (
              <div className="py-8 text-center text-xs text-emerald-700">
                ✓ All pharmacy catalog medications have sufficient stock levels.
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[...report.outOfStock, ...report.lowStock].map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50/70 p-3"
                  >
                    <div>
                      <p className="text-xs font-bold text-zinc-900">{m.name}</p>
                      <p className="text-[11px] text-zinc-500">
                        {m.strength} · {m.form}
                      </p>
                      <p className="text-[10px] text-zinc-400">
                        Cost: {money(m.costPrice)} | Retail: {money(m.unitPrice)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset",
                        m.stock === 0
                          ? "bg-red-100 text-red-800 ring-red-600/30"
                          : "bg-amber-100 text-amber-900 ring-amber-600/30",
                      )}
                    >
                      {m.stock === 0 ? "Out of Stock" : `${m.stock} units left`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {(activeTab === "debtors" || typeof window === "undefined") && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card className="p-4.5 bg-amber-50/50 border-amber-200">
              <span className="text-xs font-semibold text-amber-900 uppercase">
                Total Unsettled Debt
              </span>
              <p className="mt-1 text-2xl font-bold text-amber-950">{money(report.outstanding)}</p>
              <p className="mt-1 text-xs text-amber-800">Current unpaid patient balance</p>
            </Card>
            <Card className="p-4.5">
              <span className="text-xs font-semibold text-zinc-500 uppercase">Debtor Accounts</span>
              <p className="mt-1 text-2xl font-bold text-zinc-900">{report.debtors.length}</p>
              <p className="mt-1 text-xs text-zinc-400">Patients with active unsettled visits</p>
            </Card>
            <Card className="p-4.5">
              <span className="text-xs font-semibold text-zinc-500 uppercase">Clinic Collection Rate</span>
              <p className="mt-1 text-2xl font-bold text-emerald-700">
                {Math.round(report.collectionRate)}%
              </p>
              <p className="mt-1 text-xs text-zinc-400">Total settled vs total billings</p>
            </Card>
          </div>

          <Card className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-bold text-zinc-900">
                  Outstanding Balances Ledger
                </h2>
                <p className="text-xs text-zinc-500">
                  List of all patients with unsettled bills across all clinic visits
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <SearchIcon className="absolute left-3 top-2.5 size-4 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search patient or MRN..."
                  value={debtorSearch}
                  onChange={(e) => setDebtorSearch(e.target.value)}
                  className={cn(inputClass, "h-9 w-full pl-9 text-xs")}
                />
              </div>
            </div>

            {filteredDebtors.length === 0 ? (
              <div className="py-12 text-center text-xs text-zinc-400">
                No outstanding balances — all clinic visits have been settled!
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[650px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                      <th className="rounded-l-lg py-2.5 pl-3 font-semibold">Patient Name</th>
                      <th className="py-2.5 font-semibold">MRN</th>
                      <th className="py-2.5 font-semibold">Phone Contact</th>
                      <th className="py-2.5 font-semibold">Visit Date</th>
                      <th className="py-2.5 font-semibold">Stage</th>
                      <th className="py-2.5 pr-3 text-right font-semibold rounded-r-lg">
                        Outstanding (KSh)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredDebtors.map((d) => {
                      const pat = report.patients.get(d.visit.patientId);

                      return (
                        <tr key={d.visit.id} className="hover:bg-amber-50/40">
                          <td className="py-3 pl-3 font-bold text-zinc-900">
                            {report.nameOf(d.visit)}
                          </td>
                          <td className="py-3 font-mono text-zinc-500">{pat?.mrn || "—"}</td>
                          <td className="py-3 text-zinc-600">{pat?.phone || "—"}</td>
                          <td className="py-3 text-zinc-500">{exportDate(d.visit.createdAt)}</td>
                          <td className="py-3">
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-700">
                              {d.visit.status.replace(/-/g, " ")}
                            </span>
                          </td>
                          <td className="py-3 pr-3 text-right font-bold tabular-nums text-amber-900">
                            {money(d.owed)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      <div className="hidden print:block mt-12 border-t border-zinc-300 pt-6">
        <div className="grid grid-cols-2 gap-8 text-xs text-zinc-700">
          <div>
            <p className="font-bold text-zinc-900">Prepared & Audited By:</p>
            <div className="mt-8 border-b border-zinc-400 w-48" />
            <p className="mt-1">Clinic Administrator / Finance Officer</p>
          </div>
          <div>
            <p className="font-bold text-zinc-900">Approved By:</p>
            <div className="mt-8 border-b border-zinc-400 w-48" />
            <p className="mt-1">Medical Director / Superintendent</p>
          </div>
        </div>
      </div>
    </div>
  );
}
