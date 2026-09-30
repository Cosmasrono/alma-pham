

import { createHash, randomBytes, randomInt } from "crypto";
import { prisma } from "@/lib/prisma";
import { ROLES, type Role } from "@/lib/auth/roles";
import { isOwnerEmail, signupAllowed } from "@/lib/auth/owner";
import { isDeveloperEmail } from "@/lib/server/developer";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { mpesaConfigured } from "@/lib/server/mpesa";
import { type BranchContext, ensureBranchSetup, mapBranch } from "@/lib/server/branches";
import {
  type ChangeContext,
  type InventoryEventType,
  logInventoryEvent,
  priceFlag,
  stockFlag,
} from "@/lib/server/inventory-log";
import type {
  BillingMode,
  ChargeType,
  ClinicData,
  ClinicSettings,
  Doctor,
  Expense,
  ExpenseCategory,
  Gender,
  ID,
  LabParameter,
  LabResult,
  Med,
  Medicine,
  MedicineBatch,
  Order,
  OrderStatus,
  OrderType,
  Patient,
  Payment,
  PaymentMethod,
  Priority,
  ServiceItem,
  Shift,
  Visit,
  VisitStatus,
  Vitals,
} from "@/lib/types";

// --- row → domain mappers --------------------------------------------------

type PatientRow = Awaited<ReturnType<typeof prisma.patient.findFirstOrThrow>>;
type VisitRow = Awaited<ReturnType<typeof prisma.visit.findFirstOrThrow>>;
type OrderRow = Awaited<ReturnType<typeof prisma.order.findFirstOrThrow>>;
type UserRow = Awaited<ReturnType<typeof prisma.user.findFirstOrThrow>>;
type MedicineRow = Awaited<ReturnType<typeof prisma.medicine.findFirstOrThrow>>;

// The "doctor roster" reception assigns to is just the active doctor users.
function mapDoctor(u: UserRow): Doctor {
  return { id: u.id, name: u.name };
}

function mapPatient(p: PatientRow): Patient {
  return {
    id: p.id,
    mrn: p.mrn,
    nationalId: p.nationalId,
    firstName: p.firstName,
    lastName: p.lastName,
    gender: p.gender as Gender,
    age: p.age,
    phone: p.phone,
    registeredById: p.registeredById ?? undefined,
    createdAt: p.createdAt.toISOString(),
  };
}

function mapVisit(v: VisitRow): Visit {
  return {
    id: v.id,
    patientId: v.patientId,
    vitals: v.vitals as Vitals,
    priority: (v.priority ?? undefined) as Priority | undefined,
    complaint: v.complaint,
    assignedDoctorId: v.assignedDoctorId ?? undefined,
    status: v.status as VisitStatus,
    billingMode: v.billingMode as BillingMode,
    charges: v.charges.map((c) => ({
      id: c.id,
      type: c.type as ChargeType,
      description: c.description,
      amount: c.amount,
      paid: c.paid,
      paidAt: c.paidAt ? c.paidAt.toISOString() : undefined,
      paymentId: c.paymentId ?? undefined,
      createdAt: c.createdAt.toISOString(),
    })),
    payments: v.payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method as PaymentMethod,
      reference: p.reference ?? undefined,
      paidAt: p.paidAt.toISOString(),
      covers: p.covers,
      takenBy: p.takenBy ?? undefined,
    })),
    payment: v.payment
      ? {
          amount: v.payment.amount,
          method: v.payment.method as PaymentMethod,
          reference: v.payment.reference ?? undefined,
          paidAt: v.payment.paidAt.toISOString(),
        }
      : undefined,
    saleItems: v.saleItems.length > 0 ? v.saleItems : undefined,
    kind: v.kind === "walk-in" ? "walk-in" : undefined,
    branchId: v.branchId ?? undefined,
    walkIn: v.walkIn
      ? {
          customerName: v.walkIn.customerName ?? undefined,
          customerPhone: v.walkIn.customerPhone ?? undefined,
          prescriber: v.walkIn.prescriber ?? undefined,
          prescriberFacility: v.walkIn.prescriberFacility ?? undefined,
        }
      : undefined,
    timeline: v.timeline.map((e) => ({
      status: e.status as VisitStatus,
      at: e.at.toISOString(),
    })),
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

/** Prisma fragment: append "the visit just entered this status" to the
 *  timeline, so the journey from reception to completed is timestamped. */
function stage(status: VisitStatus) {
  return { push: { status, at: new Date() } };
}

type BatchRow = Awaited<ReturnType<typeof prisma.medicineBatch.findFirstOrThrow>>;
type ShiftRow = Awaited<ReturnType<typeof prisma.shift.findFirstOrThrow>>;

function mapMedicine(m: MedicineRow, batches?: BatchRow[]): Medicine {
  const base: Medicine = {
    id: m.id,
    name: m.name,
    strength: m.strength,
    form: m.form,
    unitPrice: m.unitPrice,
    costPrice: m.costPrice,
    stock: m.stock,
    requiresPrescription: m.requiresPrescription ?? false,
    barcode: m.barcode ?? undefined,
    genericName: m.genericName ?? undefined,
    reorderLevel: m.reorderLevel ?? undefined,
  };
  // Medicines with no batches recorded yet fall back to the plain stock count.
  if (!batches?.length) return base;
  const now = Date.now();
  let sellable = 0;
  let expired = 0;
  let nextExpiry: Date | null = null;
  for (const b of batches) {
    if (b.expiryDate && b.expiryDate.getTime() < now) {
      expired += b.quantity;
      continue;
    }
    sellable += b.quantity;
    if (b.expiryDate && (!nextExpiry || b.expiryDate < nextExpiry)) nextExpiry = b.expiryDate;
  }
  return {
    ...base,
    sellable,
    expired,
    nextExpiry: nextExpiry ? nextExpiry.toISOString() : undefined,
  };
}

function mapBatch(b: BatchRow): MedicineBatch {
  return {
    id: b.id,
    medicineId: b.medicineId,
    batchNumber: b.batchNumber ?? undefined,
    expiryDate: b.expiryDate ? b.expiryDate.toISOString() : undefined,
    quantity: b.quantity,
    costPrice: b.costPrice ?? undefined,
    receivedAt: b.receivedAt.toISOString(),
    receivedBy: b.receivedBy ?? undefined,
    notes: b.notes ?? undefined,
    branchId: b.branchId ?? undefined,
  };
}

function mapShift(s: ShiftRow): Shift {
  return {
    id: s.id,
    cashierId: s.cashierId,
    cashierName: s.cashierName,
    status: s.status as Shift["status"],
    openedAt: s.openedAt.toISOString(),
    closedAt: s.closedAt ? s.closedAt.toISOString() : undefined,
    openingCash: s.openingCash,
    openingNotes: s.openingNotes ?? undefined,
    closingCashCounted: s.closingCashCounted ?? undefined,
    closingNotes: s.closingNotes ?? undefined,
    totalCashSales: s.totalCashSales,
    totalMpesaSales: s.totalMpesaSales,
    totalCardSales: s.totalCardSales,
    expectedClosingCash: s.expectedClosingCash ?? undefined,
    cashShortageOverage: s.cashShortageOverage ?? undefined,
    mpesaVariance: s.mpesaVariance ?? undefined,
  };
}

// --- batches (FEFO) ----------------------------------------------------------

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma;

/** Move one branch's stock of a medicine by `delta`, keeping the catalog's
 *  all-branch total in step. Every stock change goes through here — and it
 *  can't be called without saying what kind of change it is and who made
 *  it, because it writes the inventory audit row in the same transaction. */
async function adjustBranchStock(
  tx: Tx,
  medicineId: ID,
  branchId: ID,
  delta: number,
  log: { type: InventoryEventType } & ChangeContext,
) {
  if (delta === 0) return;
  const row = await tx.medicineStock.upsert({
    where: { medicineId_branchId: { medicineId, branchId } },
    update: { quantity: { increment: delta } },
    create: { medicineId, branchId, quantity: delta },
  });
  const med = await tx.medicine.update({
    where: { id: medicineId },
    data: { stock: { increment: delta } },
    select: { name: true, strength: true },
  });
  await logInventoryEvent(tx, {
    ...log,
    medicineId,
    medicineName: `${med.name} ${med.strength}`.trim(),
    branchId,
    quantity: delta,
    stockAfter: row.quantity,
    flagReason: stockFlag(log.type, delta, row.quantity - delta),
  });
}

/** A branch's current count of each of these medicines. */
async function branchStockOf(medicineIds: ID[], branchId: ID): Promise<Map<ID, number>> {
  const rows = await prisma.medicineStock.findMany({
    where: { branchId, medicineId: { in: medicineIds } },
  });
  return new Map(rows.map((r) => [r.medicineId, r.quantity]));
}

/** Every write to the database is a round trip to Atlas, so the default 5 s
 *  interactive-transaction budget runs out on a multi-item sale. Reads are
 *  done before the transaction starts; this is headroom for the writes. */
const SALE_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** Thrown inside a sale's transaction when a batch changed since the sale was
 *  planned (another till sold from it) — the whole sale rolls back. */
class StockChangedError extends Error {}

type FefoTake = { batchId: ID; take: number };

/** Plan an earliest-expiry-first draw-down for a cart. Done before the
 *  transaction so the transaction itself only writes. Medicines with no
 *  batches recorded produce no takes (they sell off the plain count). */
async function planFefo(
  items: { medicineId: ID; quantity: number }[],
  branchId: ID,
): Promise<FefoTake[]> {
  const batches = await prisma.medicineBatch.findMany({
    where: {
      branchId, // only this branch's shelf
      medicineId: { in: [...new Set(items.map((i) => i.medicineId))] },
      quantity: { gt: 0 },
      OR: [{ expiryDate: null }, { expiryDate: { gte: new Date() } }],
    },
    orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
  });
  const left = new Map(batches.map((b) => [b.id, b.quantity]));
  const plan: FefoTake[] = [];
  for (const item of items) {
    let remaining = item.quantity;
    for (const b of batches) {
      if (remaining <= 0) break;
      if (b.medicineId !== item.medicineId) continue;
      const take = Math.min(left.get(b.id) ?? 0, remaining);
      if (take <= 0) continue;
      left.set(b.id, (left.get(b.id) ?? 0) - take);
      plan.push({ batchId: b.id, take });
      remaining -= take;
    }
  }
  return plan;
}

/** Apply a FEFO plan inside the sale's transaction. Each decrement only goes
 *  through if the batch still holds enough, so two tills can never draw the
 *  same units down twice — if one lost the race, its sale rolls back. */
async function applyFefo(tx: Tx, plan: FefoTake[]) {
  for (const { batchId, take } of plan) {
    const r = await tx.medicineBatch.updateMany({
      where: { id: batchId, quantity: { gte: take } },
      data: { quantity: { decrement: take } },
    });
    if (r.count !== 1) throw new StockChangedError();
  }
}

const STOCK_CHANGED = "Stock changed while this sale was being recorded — nothing was charged to stock. Please try again.";

type ExpenseRow = Awaited<ReturnType<typeof prisma.expense.findFirstOrThrow>>;

function mapExpense(e: ExpenseRow): Expense {
  return {
    id: e.id,
    description: e.description,
    category: e.category as ExpenseCategory,
    amount: e.amount,
    date: e.date.toISOString(),
    recordedBy: e.recordedBy ?? undefined,
    createdAt: e.createdAt.toISOString(),
  };
}

function mapOrder(o: OrderRow): Order {
  return {
    id: o.id,
    visitId: o.visitId,
    type: o.type as OrderType,
    title: o.title,
    instructions: o.instructions ?? undefined,
    status: o.status as OrderStatus,
    serviceItemId: o.serviceItemId ?? undefined,
    results: o.results.length > 0
      ? o.results.map((r) => ({
          parameter: r.parameter,
          value: r.value,
          flag: (r.flag ?? undefined) as LabResult["flag"],
        }))
      : undefined,
    result: o.result ?? undefined,
    meds: (o.meds as Med[] | undefined)?.length ? (o.meds as Med[]) : undefined,
    createdAt: o.createdAt.toISOString(),
    completedAt: o.completedAt ? o.completedAt.toISOString() : undefined,
  };
}

type ServiceItemRow = Awaited<
  ReturnType<typeof prisma.serviceItem.findFirstOrThrow>
>;

function mapServiceItem(t: ServiceItemRow): ServiceItem {
  return {
    id: t.id,
    name: t.name,
    orderType: t.orderType as ServiceItem["orderType"],
    category: t.category,
    price: t.price,
    parameters: t.parameters.map((p) => ({
      name: p.name,
      unit: p.unit,
      refLow: p.refLow ?? undefined,
      refHigh: p.refHigh ?? undefined,
    })),
    active: t.active,
    createdAt: t.createdAt.toISOString(),
  };
}

type ClinicSettingsRow = Awaited<
  ReturnType<typeof prisma.clinicSettings.findFirstOrThrow>
>;

function mapSettings(s: ClinicSettingsRow): ClinicSettings {
  return {
    id: s.id,
    billingMode: s.billingMode as BillingMode,
    consultationFee: s.consultationFee,
    updatedAt: s.updatedAt.toISOString(),
    updatedById: s.updatedById ?? undefined,
  };
}

/** Read the singleton clinic settings, creating a default row on first call. */
async function readSettings(): Promise<ClinicSettings> {
  const existing = await prisma.clinicSettings.findFirst();
  if (existing) return mapSettings(existing);
  const created = await prisma.clinicSettings.create({ data: {} });
  return mapSettings(created);
}

// --- billing ---------------------------------------------------------------
//
// A charge is created the moment the thing being charged for is ordered, in
// both billing modes. The mode only decides whether the patient is *stopped*
// at that point: per-stage holds them at the cashier until the charge is
// settled, pay-at-end lets them walk on with the bill running and collects
// everything once, at the pharmacy.

type ChargeRow = VisitRow["charges"][number];

/** Service charges — the ones that gate `awaiting-lab-payment`. */
const SERVICE_CHARGE_TYPES: ChargeType[] = ["lab", "radiology", "procedure"];

/** A fresh unpaid charge row. Amounts are rounded to the cent so repeated
 *  float arithmetic can never leave a bill that won't settle to zero. */
function newCharge(
  type: ChargeType,
  description: string,
  amount: number,
): ChargeRow {
  return {
    id: crypto.randomUUID(),
    type,
    description,
    amount: Math.round(amount * 100) / 100,
    paid: false,
    paidAt: null,
    paymentId: null,
    createdAt: new Date(),
  };
}

function unpaid(charges: ChargeRow[]): ChargeRow[] {
  return charges.filter((c) => !c.paid);
}

function totalOf(charges: ChargeRow[]): number {
  return Math.round(charges.reduce((s, c) => s + c.amount, 0) * 100) / 100;
}

/** Mark `settled` as paid by `paymentId`, leaving every other charge alone. */
function settleCharges(
  charges: ChargeRow[],
  settled: ChargeRow[],
  paymentId: string,
  paidAt: Date,
): ChargeRow[] {
  const ids = new Set(settled.map((c) => c.id));
  return charges.map((c) =>
    ids.has(c.id) ? { ...c, paid: true, paidAt, paymentId } : c,
  );
}

/** The opening state of a new visit: the billing mode snapshot, the
 *  consultation charge (when the clinic charges one), and where the patient
 *  starts. Snapshotting the mode here is what stops an admin's mid-visit
 *  toggle from retroactively rewriting how this visit is charged. */
async function openingVisitState() {
  const settings = await readSettings();
  const charges =
    settings.consultationFee > 0
      ? [newCharge("consultation", "Consultation fee", settings.consultationFee)]
      : [];
  // A free consultation has nothing to collect, so there is no gate to hold
  // the patient at even in per-stage mode.
  const status: VisitStatus =
    settings.billingMode === "per-stage" && charges.length > 0
      ? "awaiting-consult-payment"
      : "awaiting-triage";
  return {
    billingMode: settings.billingMode,
    charges,
    status,
    timeline: [{ status, at: new Date() }],
  };
}

// --- absences ----------------------------------------------------------------

/** UTC-midnight bounds of today's calendar date. Activity dates arrive as
 *  "YYYY-MM-DD" strings, so they are stored as UTC midnights of the picked
 *  day — compare against the same representation. */
function todayBounds() {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Users with an approved absence in effect right now — a leave range that
 *  spans today, or an excuse whose leave→return window contains this moment.
 *  They vanish from the doctor roster and become active again automatically
 *  the moment the window lapses. */
async function absentUserIds(): Promise<Set<ID>> {
  const now = new Date();
  const { start, end } = todayBounds();
  const absences = await prisma.activityRequest.findMany({
    where: {
      status: "approved",
      OR: [
        { type: "leave", startDate: { lt: end }, endDate: { gte: start } },
        { type: "excuse", excuseDate: { gte: start, lt: end } },
      ],
    },
    select: { userId: true, type: true, excuseStart: true, excuseEnd: true },
  });

  const away = new Set<ID>();
  for (const a of absences) {
    if (a.type === "leave") {
      away.add(a.userId);
    } else if (a.excuseStart && a.excuseEnd) {
      // Timed excuse: away only between leaving and the return time.
      if (a.excuseStart <= now && now < a.excuseEnd) away.add(a.userId);
    } else {
      // Legacy excuse without a time: err on the side of the whole day.
      away.add(a.userId);
    }
  }
  return away;
}

/** Rejects routing a patient to a doctor who is away today. The roster
 *  already hides them; this guards against stale clients. */
async function doctorAbsentError(
  doctorId: ID | null | undefined,
): Promise<string | null> {
  if (!doctorId) return null;
  return (await absentUserIds()).has(doctorId)
    ? "That doctor is away today (approved leave or excuse). Please choose another doctor."
    : null;
}

// --- reads -----------------------------------------------------------------

/** Every staff member sees the whole clinic: all patients, their visit
 *  statuses and timings. (Who registered a patient is still recorded on the
 *  record, it just doesn't restrict visibility.) */
export async function getClinicData(opts?: {
  // Expenses are financial data — only admins get them in the dataset.
  includeFinance?: boolean;
  /** Incremental refresh: only patients, visits, orders and M-Pesa records
   *  changed after this moment (the client merges them by id). The small
   *  tables — doctors, medicines, catalog, settings, expenses, cash counts —
   *  always come in full, so deletions and edits there need no tracking. */
  since?: Date;
  /** The signed-in user, so their open till session comes with the data. */
  userId?: ID;
  /** Which branch to show (see branchContext). Omitted = every branch. */
  branch?: BranchContext;
}): Promise<ClinicData> {
  // Taken before querying. The cursor handed back is a little earlier still,
  // so a write that lands mid-query (or on a server with a slightly skewed
  // clock) is re-sent next time rather than missed; merging by id makes a
  // repeat harmless.
  const startedAt = Date.now();
  const since = opts?.since;
  const changed = since ? { updatedAt: { gt: since } } : {};
  // One branch's queue, lab, pharmacy and stock — or every branch's (admins).
  const view = opts?.branch?.viewBranchId ?? null;
  const inBranch = view ? { branchId: view } : {};
  const [
    allDoctors,
    absent,
    patients,
    visits,
    orders,
    medicines,
    serviceCatalog,
    settings,
    expenses,
    cashCounts,
    mpesaTxns,
    batches,
    myShift,
    shifts,
    branches,
    branchStock,
    transfers,
  ] = await Promise.all([
    prisma.user.findMany({
      where: {
        role: "doctor",
        active: true,
        // A doctor with no branch covers every branch.
        ...(view && {
          OR: [{ branchId: view }, { branchId: null }, { branchId: { isSet: false } }],
        }),
      },
      orderBy: { name: "asc" },
    }),
    absentUserIds(),
    // Patients are never edited after registration, so creation time suffices.
    // The shared walk-in record isn't a patient — keep it out of patient
    // lists, search and counts. Its counter sales still arrive as visits.
    prisma.patient.findMany({
      where: {
        mrn: { not: WALK_IN_MRN },
        ...(since && { createdAt: { gt: since } }),
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.visit.findMany({ where: { ...changed, ...inBranch }, orderBy: { createdAt: "asc" } }),
    prisma.order.findMany({ where: { ...changed, ...inBranch }, orderBy: { createdAt: "asc" } }),
    prisma.medicine.findMany({ orderBy: { name: "asc" } }),
    prisma.serviceItem.findMany({
      where: { active: true },
      orderBy: [{ orderType: "asc" }, { category: "asc" }, { name: "asc" }],
    }),
    readSettings(),
    opts?.includeFinance
      ? prisma.expense.findMany({ orderBy: { date: "desc" } })
      : Promise.resolve([]),
    opts?.includeFinance
      ? prisma.cashCount.findMany({ orderBy: { date: "desc" } })
      : Promise.resolve([]),
    opts?.includeFinance
      ? prisma.mpesaTransaction.findMany({ where: changed, orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
    // Only stock still on the shelf — emptied batches are history.
    prisma.medicineBatch.findMany({
      where: { quantity: { gt: 0 }, ...inBranch },
      orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
    }),
    opts?.userId
      ? prisma.shift.findFirst({ where: { cashierId: opts.userId, status: "open" } })
      : Promise.resolve(null),
    // Recently closed tills, for the manager's reconciliation view.
    opts?.includeFinance
      ? prisma.shift.findMany({
          where: { status: { not: "open" }, ...inBranch },
          orderBy: { closedAt: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
    prisma.branch.findMany({ orderBy: [{ isMain: "desc" }, { name: "asc" }] }),
    // This branch's own counts; the catalog total covers "all branches".
    view ? prisma.medicineStock.findMany({ where: { branchId: view } }) : Promise.resolve([]),
    prisma.stockTransfer.findMany({
      where: view ? { OR: [{ fromBranchId: view }, { toBranchId: view }] } : {},
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const stockHere = new Map(branchStock.map((s) => [s.medicineId, s.quantity]));

  const batchesByMedicine = new Map<string, BatchRow[]>();
  for (const b of batches) {
    const list = batchesByMedicine.get(b.medicineId);
    if (list) list.push(b);
    else batchesByMedicine.set(b.medicineId, [b]);
  }

  // Staff away today (approved leave/excuse) are not offered for assignment.
  const doctors = allDoctors.filter((d) => !absent.has(d.id));

  return {
    doctors: doctors.map(mapDoctor),
    patients: patients.map(mapPatient),
    visits: visits.map(mapVisit),
    orders: orders.map(mapOrder),
    medicines: medicines.map((m) =>
      mapMedicine(
        // In one branch's view, "stock" means that branch's shelf.
        view ? { ...m, stock: stockHere.get(m.id) ?? 0 } : m,
        batchesByMedicine.get(m.id),
      ),
    ),
    batches: batches.map(mapBatch),
    branches: branches.map(mapBranch),
    viewBranchId: view,
    canSwitchBranch: opts?.branch?.canSwitch ?? false,
    transfers: transfers.map((t) => ({
      id: t.id,
      medicineId: t.medicineId,
      fromBranchId: t.fromBranchId,
      toBranchId: t.toBranchId,
      quantity: t.quantity,
      notes: t.notes ?? undefined,
      byName: t.byName ?? undefined,
      createdAt: t.createdAt.toISOString(),
    })),
    myShift: myShift ? mapShift(myShift) : null,
    shifts: shifts.map(mapShift),
    serviceCatalog: serviceCatalog.map(mapServiceItem),
    settings,
    expenses: expenses.map(mapExpense),
    cashCounts: cashCounts.map((c) => ({
      id: c.id,
      date: c.date.toISOString().slice(0, 10),
      counted: c.counted,
      notes: c.notes ?? undefined,
      countedBy: c.countedBy ?? undefined,
      createdAt: c.createdAt.toISOString(),
    })),
    mpesaTransactions: mpesaTxns.map((t) => ({
      id: t.id,
      phone: t.phone,
      amount: t.amount,
      status: t.status as "pending" | "success" | "failed",
      receipt: t.receipt ?? undefined,
      visitId: t.visitId ?? undefined,
      createdAt: t.createdAt.toISOString(),
    })),
    syncedAt: new Date(startedAt - 15_000).toISOString(),
    ...(since && { partial: true as const }),
  };
}

// --- writes ----------------------------------------------------------------

const EMPTY_VITALS: Vitals = { weight: "", temperature: "", bloodPressure: "" };

// Doctors take an unlimited queue: reception allocates as many patients as it
// likes and each doctor works through their own queue in priority order, so
// there is no "doctor is busy" rejection on assignment.

export async function registerPatient(input: {
  nationalId: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  age: number;
  phone: string;
  assignedDoctorId?: ID;
  registeredById?: ID; // stamped from the session by the API route
  branchId?: ID; // stamped from the session: where the patient checked in
}) {
  const away = await doctorAbsentError(input.assignedDoctorId);
  if (away) return { error: away };

  // Never create a second record for the same national ID — the client's
  // lookup runs against a snapshot that may be stale.
  const nationalId = input.nationalId.trim();
  const existing = await prisma.patient.findFirst({
    where: { nationalId: { equals: nationalId, mode: "insensitive" } },
  });
  if (existing) {
    return {
      error: `A patient with national ID ${nationalId} is already registered (${existing.mrn} · ${existing.firstName} ${existing.lastName}). Use Find to check them in instead.`,
    };
  }

  // Real patients only — the shared walk-in record must not shift numbering.
  const count = await prisma.patient.count({ where: { mrn: { startsWith: "P-" } } });
  const mrn = `P-${String(count + 1).padStart(4, "0")}`;
  const patient = await prisma.patient.create({
    data: {
      mrn,
      nationalId,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      gender: input.gender,
      age: input.age,
      phone: input.phone.trim(),
      registeredById: input.registeredById || null,
    },
  });
  await prisma.visit.create({
    data: {
      patientId: patient.id,
      vitals: EMPTY_VITALS,
      complaint: "",
      assignedDoctorId: input.assignedDoctorId || null,
      branchId: input.branchId ?? (await ensureBranchSetup()),
      ...(await openingVisitState()),
    },
  });
}

export async function startVisit(input: {
  patientId: ID;
  assignedDoctorId?: ID;
  branchId?: ID; // stamped from the session: where the patient checked in
}) {
  const away = await doctorAbsentError(input.assignedDoctorId);
  if (away) return { error: away };

  // One open visit per patient — guards against double-clicks and stale UIs.
  const open = await prisma.visit.findFirst({
    where: { patientId: input.patientId, status: { not: "completed" } },
  });
  if (open) {
    return { error: "This patient already has an active visit (it may be at another branch)." };
  }

  await prisma.visit.create({
    data: {
      patientId: input.patientId,
      vitals: EMPTY_VITALS,
      complaint: "",
      assignedDoctorId: input.assignedDoctorId || null,
      branchId: input.branchId ?? (await ensureBranchSetup()),
      ...(await openingVisitState()),
    },
  });
}

export async function recordTriage(input: {
  visitId: ID;
  vitals: Vitals;
  priority: Priority;
}) {
  const isEmergency = input.priority === "emergency";
  await prisma.visit.update({
    where: { id: input.visitId },
    data: {
      vitals: { set: input.vitals },
      priority: input.priority,
      // Emergency cases bypass the normal waiting queue and are
      // fast-tracked straight to doctor handling.
      status: isEmergency ? "with-doctor" : "waiting",
      timeline: stage(isEmergency ? "with-doctor" : "waiting"),
    },
  });
}

export async function assignVisitDoctor(input: { visitId: ID; doctorId: ID }) {
  const away = await doctorAbsentError(input.doctorId);
  if (away) return { error: away };

  await prisma.visit.update({
    where: { id: input.visitId },
    data: { assignedDoctorId: input.doctorId },
  });
}

// --- user management (admin) ----------------------------------------------



export interface StaffUser {
  id: ID;
  username: string;
  email: string | null;
  name: string;
  role: Role;
  active: boolean;
  /** Where they work; null = every branch (admins) / main (other staff). */
  branchId: ID | null;
  createdAt: string;
}

function mapUser(u: UserRow): StaffUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    name: u.name,
    role: u.role as Role,
    active: u.active,
    branchId: u.branchId ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

/** A branch id from the admin's user form: empty = none (every branch). */
async function validBranchId(raw: unknown): Promise<{ error: string } | { branchId: ID | null }> {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id) return { branchId: null };
  const branch = await prisma.branch.findUnique({ where: { id } });
  if (!branch) return { error: "That branch no longer exists." };
  if (!branch.active) return { error: `${branch.name} is closed — pick an open branch.` };
  return { branchId: id };
}

/** Normalises an email for storage/lookup; returns null when blank. */
function cleanEmail(raw: string | undefined | null): string | null {
  const email = String(raw ?? "")
    .trim()
    .toLowerCase();
  return email || null;
}

/** Cheap format check — enough to catch typos typed into the setup form. */
function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** True when another user already owns this email (schema can't enforce it). */
async function emailTaken(email: string, exceptId?: ID): Promise<boolean> {
  const owner = await prisma.user.findFirst({ where: { email } });
  return Boolean(owner && owner.id !== exceptId);
}

export async function userCount(): Promise<number> {
  return prisma.user.count();
}

// --- one-time admin sign-up ---------------------------------------------------
//
// Only the client's owner and admin emails configured in ClinicSettings may
// sign up. Both use the admin role; other staff receive invitations.

const SIGNUP_CODE_TTL_MS = 15 * 60 * 1000;
const SIGNUP_RESEND_MS = 60 * 1000;
const SIGNUP_MAX_ATTEMPTS = 5;

/** Step 1: check the details, park them, and return the code to email. */
export async function startAdminSignup(input: {
  name: string;
  username: string;
  email: string;
  password: string;
}): Promise<{ error: string } | { code: string; email: string; name: string }> {
  const username = String(input.username ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  const password = String(input.password ?? "");
  if (!username || !name || !password) {
    return { error: "Name, username and password are all required." };
  }
  if (password.length < 8) {
    return { error: "Choose a password of at least 8 characters." };
  }
  // The admin must have an email. There is no other admin who could reset
  // their password, so the reset link is their only way back in.
  const email = cleanEmail(input.email);
  if (!email || !validEmail(email)) {
    return { error: "A valid email address is required." };
  }
  if (!(await signupAllowed(email))) return { error: "Signup is restricted to the owner and approved administrator. Ask your administrator for a staff invitation." };
  if (await emailTaken(email)) return { error: "An account already exists for this email. Please sign in or reset your password." };
  if (await prisma.user.findUnique({ where: { username } })) return { error: "That username is already taken." };

  const recent = await prisma.adminSignup.findUnique({ where: { email } });
  if (recent && Date.now() - recent.createdAt.getTime() < SIGNUP_RESEND_MS) {
    return { error: "A code was just sent. Wait a minute before asking for another." };
  }

  await prisma.adminSignup.deleteMany({ where: { email } });
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.adminSignup.create({
    data: {
      name,
      username,
      email,
      passwordHash: await hashPassword(password),
      codeHash: await hashPassword(code),
      expiresAt: new Date(Date.now() + SIGNUP_CODE_TTL_MS),
    },
  });
  return { code, email, name };
}

/** Step 2: check the emailed code and create the admin account. */
export async function verifyAdminSignup(
  rawEmail: string,
  rawCode: string,
): Promise<{ error: string } | { user: StaffUser }> {
  const email = cleanEmail(rawEmail);
  if (!email || !(await signupAllowed(email))) return { error: "Signup is restricted to the owner and approved administrator." };
  const code = String(rawCode ?? "").trim();
  const pending = email
    ? await prisma.adminSignup.findUnique({ where: { email } })
    : null;
  if (!pending) {
    return { error: "No sign-up is waiting for that email. Please start again." };
  }
  if (pending.expiresAt.getTime() < Date.now()) {
    await prisma.adminSignup.delete({ where: { id: pending.id } });
    return { error: "That code has expired. Please sign up again." };
  }
  if (pending.attempts >= SIGNUP_MAX_ATTEMPTS) {
    await prisma.adminSignup.delete({ where: { id: pending.id } });
    return { error: "Too many wrong codes. Please sign up again." };
  }
  if (!/^\d{6}$/.test(code) || !(await verifyPassword(code, pending.codeHash))) {
    await prisma.adminSignup.update({
      where: { id: pending.id },
      data: { attempts: { increment: 1 } },
    });
    const left = SIGNUP_MAX_ATTEMPTS - pending.attempts - 1;
    return {
      error: left > 0
        ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.`
        : "Too many wrong codes. Please sign up again.",
    };
  }

  return prisma.$transaction(async (tx) => {
    // Claim this exact code once; concurrent verification cannot create two users.
    const claim = await tx.adminSignup.deleteMany({
      where: {
        id: pending.id,
        codeHash: pending.codeHash,
        attempts: { lt: SIGNUP_MAX_ATTEMPTS },
        expiresAt: { gt: new Date() },
      },
    });
    if (claim.count !== 1) return { error: "This code has already been used or expired. Please start again." };
    if (await tx.user.findFirst({ where: { OR: [{ email }, { username: pending.username }] } })) return { error: "An account with this email or username already exists. Please sign in." };
    const user = await tx.user.create({
      data: {
        username: pending.username,
        email: pending.email,
        name: pending.name,
        role: "admin",
        passwordHash: pending.passwordHash,
        active: true,
      },
    });
    return { user: mapUser(user) };
  });
}

export async function listUsers(): Promise<StaffUser[]> {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return users.map(mapUser);
}

export async function createUser(input: {
  username: string;
  email?: string;
  name: string;
  role: Role;
  password?: string;
  branchId?: string;
}): Promise<{ error: string } | { user: StaffUser }> {
  const username = String(input.username ?? "").trim().toLowerCase();
  if (!username || !String(input.name ?? "").trim()) {
    return { error: "Username and name are required." };
  }
  if (input.role === "admin") {
    return { error: "The owner and approved administrator must use email-verified signup." };
  }
  if (!ROLES.includes(input.role) || input.role === "developer") return { error: "Choose a valid staff role." };
  const branch = await validBranchId(input.branchId);
  if ("error" in branch) return branch;
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return { error: "That username is already taken." };

  const email = cleanEmail(input.email);
  if (!email || !validEmail(email)) return { error: "A valid email address is required to send the password setup link." };
  if (isDeveloperEmail(email)) return { error: "This email is reserved for developer access." };
  if (await signupAllowed(email)) return { error: "This email is reserved for owner or administrator signup." };
  if (await emailTaken(email)) return { error: "That email is already used by another account." };

  // This random password is never shared. Staff choose their own through email.
  const bootstrapPassword = randomBytes(32).toString("base64url");

  const user = await prisma.user.create({
    data: {
      username,
      email,
      name: input.name.trim(),
      role: input.role,
      passwordHash: await hashPassword(bootstrapPassword),
      active: true,
      branchId: branch.branchId,
    },
  });
  return { user: mapUser(user) };
}

export async function updateUser(input: {
  id: ID;
  role?: Role;
  active?: boolean;
  password?: string;
  email?: string;
  branchId?: string; // "" = no branch (every branch for admins)
}): Promise<{ error: string } | { user: StaffUser }> {
  const data: {
    role?: string;
    active?: boolean;
    passwordHash?: string;
    email?: string | null;
    branchId?: string | null;
  } = {};
  // Administrator access is assigned through approved signup only.
  // Protect administrators from being demoted or switched off here.
  const target = await prisma.user.findUnique({ where: { id: input.id } });
  if (!target) return { error: "User not found." };
  if (input.role && (!ROLES.includes(input.role) || input.role === "developer")) return { error: "Choose a valid staff role." };
  if (input.role && input.role !== target.role) {
    if (input.role === "admin") return { error: "Administrators must use approved email signup." };
    if (target.role === "admin") return { error: "The administrator's role can't be changed." };
  }
  if (target.role === "admin" && input.active === false) {
    return { error: "The administrator account can't be deactivated." };
  }
  if (input.branchId !== undefined) {
    const branch = await validBranchId(input.branchId);
    if ("error" in branch) return branch;
    data.branchId = branch.branchId;
  }
  if (input.role) data.role = input.role;
  if (typeof input.active === "boolean") data.active = input.active;
  if (input.password) data.passwordHash = await hashPassword(input.password);
  if (input.email !== undefined) {
    const email = cleanEmail(input.email);
    if ((await isOwnerEmail(target.email)) && email !== cleanEmail(target.email)) return { error: "The owner's email cannot be changed." };
    if (email !== cleanEmail(target.email) && email && await signupAllowed(email)) return { error: "This email is reserved for owner or administrator signup." };
    if (email && (await emailTaken(email, input.id))) {
      return { error: "That email is already used by another account." };
    }
    data.email = email;
  }
  const user = await prisma.user.update({ where: { id: input.id }, data });
  return { user: mapUser(user) };
}

export async function getUserById(id: ID): Promise<StaffUser | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? mapUser(user) : null;
}

export async function deleteUser(
  id: ID,
): Promise<{ error: string } | { ok: true }> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return { error: "User not found." };
  if (await isOwnerEmail(user.email)) {
    return { error: "This user cannot be deleted." };
  }
  await prisma.user.delete({ where: { id } });
  return { ok: true };
}

// --- password reset ----------------------------------------------------------

const RESET_TTL_MS = 30 * 60 * 1000; // links live for 30 minutes
// Setup links are emailed to someone who has no password yet and may not read
// their mail the same day, so they get a much longer window than a reset.
export const SETUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Starts a reset for the account with this email. Returns the plaintext token
 * (for the emailed link) plus the recipient, or null when no active account
 * matches — callers respond identically either way so the endpoint can't be
 * used to probe which emails exist.
 */
export async function createPasswordReset(
  rawEmail: string,
  ttlMs: number = RESET_TTL_MS,
): Promise<{ token: string; to: string; name: string } | null> {
  const email = cleanEmail(rawEmail);
  if (!email) return null;
  const user = await prisma.user.findFirst({ where: { email, active: true } });
  if (!user) return null;

  // A new request supersedes any outstanding links.
  await prisma.passwordReset.deleteMany({ where: { userId: user.id } });

  const token = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return { token, to: email, name: user.name };
}

/** Consumes a reset token and sets the new password. */
export async function resetPasswordWithToken(
  token: string,
  password: string,
): Promise<{ error: string } | { username: string }> {
  if (!password || password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const reset = await tx.passwordReset.findUnique({
      where: { tokenHash: hashToken(String(token ?? "")) },
    });
    const invalid = { error: "This reset link is invalid or has expired. Request a new one." };
    if (!reset || reset.usedAt || reset.expiresAt <= now) return invalid;
    const user = await tx.user.findUnique({ where: { id: reset.userId } });
    if (!user?.active) return invalid;
    // MongoDB distinguishes a missing field from an explicit null.
    const claimed = await tx.passwordReset.updateMany({
      where: { id: reset.id, expiresAt: { gt: now }, OR: [{ usedAt: null }, { usedAt: { isSet: false } }] },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return invalid;
    await tx.user.update({
      where: { id: user.id, active: true },
      data: { passwordHash },
    });
    await tx.passwordReset.deleteMany({ where: { userId: user.id, id: { not: reset.id } } });
    return { username: user.username };
  });
}

// --- medicine catalog (admin) -----------------------------------------------

export async function addMedicine(input: {
  name: string;
  strength: string;
  form: string;
  unitPrice: number;
  costPrice?: number;
  stock: number;
  requiresPrescription?: boolean;
  genericName?: string;
  barcode?: string;
  reorderLevel?: number;
  branchId?: ID; // stamped from the session: whose shelf the opening stock is on
  changedBy?: string; // stamped from the session, for the inventory log
  changedById?: ID;
}): Promise<{ error: string } | void> {
  const name = input.name?.trim();
  const strength = input.strength?.trim() ?? "";
  const form = input.form?.trim();
  if (!name || !form) return { error: "Name and form are required." };

  const unitPrice = Number(input.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return { error: "Enter a valid unit price." };
  }
  const costPrice = Number(input.costPrice ?? 0);
  if (!Number.isFinite(costPrice) || costPrice < 0) {
    return { error: "Enter a valid cost price." };
  }
  const stock = Math.max(0, Math.round(Number(input.stock) || 0));

  // One catalog entry per name+strength — restock the existing one instead.
  const existing = await prisma.medicine.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      strength: { equals: strength, mode: "insensitive" },
    },
  });
  if (existing) {
    return {
      error: `${existing.name} ${existing.strength} is already in the catalog — update its stock or price in the list instead.`,
    };
  }

  const created = await prisma.medicine.create({
    data: {
      name,
      strength,
      form,
      unitPrice,
      costPrice,
      stock: 0, // set through the branch below, so the two never disagree
      requiresPrescription: input.requiresPrescription === true,
      genericName: cleanText(input.genericName, 120),
      barcode: cleanText(input.barcode, 60),
      ...(input.reorderLevel !== undefined && {
        reorderLevel: Math.max(0, Math.round(Number(input.reorderLevel) || 0)),
      }),
    },
  });
  const branchId = input.branchId ?? (await ensureBranchSetup());
  const by = { byName: input.changedBy, byId: input.changedById };
  // Opening stock sits on the shelf of the branch adding the medicine.
  await adjustBranchStock(prisma, created.id, branchId, stock, { type: "opening", ...by });
  // The catalog entry itself is part of the trail too (price it started at).
  await logInventoryEvent(prisma, {
    type: "edit",
    medicineId: created.id,
    medicineName: `${name} ${strength}`.trim(),
    branchId,
    details: `Added to catalog at KSh ${unitPrice} (cost ${costPrice})`,
    flagReason: unitPrice < costPrice ? `Selling price below cost (KSh ${unitPrice} < ${costPrice})` : null,
    ...by,
  });
}

export async function updateMedicine(input: {
  id: ID;
  name?: string;
  strength?: string;
  form?: string;
  unitPrice?: number;
  costPrice?: number;
  stock?: number;
  requiresPrescription?: boolean;
  genericName?: string;
  barcode?: string;
  reorderLevel?: number;
  branchId?: ID; // stamped from the session: whose shelf a stock count sets
  changedBy?: string; // stamped from the session, for the inventory log
  changedById?: ID;
}): Promise<{ error: string } | void> {
  const before = await prisma.medicine.findUnique({ where: { id: input.id } });
  if (!before) return { error: "That medicine is no longer in the catalog." };
  const data: {
    name?: string;
    strength?: string;
    form?: string;
    unitPrice?: number;
    costPrice?: number;
    requiresPrescription?: boolean;
    genericName?: string | null;
    barcode?: string | null;
    reorderLevel?: number | null;
  } = {};
  if (input.requiresPrescription !== undefined) {
    data.requiresPrescription = input.requiresPrescription === true;
  }
  if (input.genericName !== undefined) data.genericName = cleanText(input.genericName, 120);
  if (input.barcode !== undefined) data.barcode = cleanText(input.barcode, 60);
  if (input.reorderLevel !== undefined) {
    const level = Math.round(Number(input.reorderLevel));
    if (!Number.isFinite(level) || level < 0) return { error: "Reorder level must be zero or more." };
    data.reorderLevel = level;
  }

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { error: "Name cannot be blank." };
    data.name = name;
  }
  if (input.strength !== undefined) {
    data.strength = input.strength.trim();
  }
  if (input.form !== undefined) {
    const form = input.form.trim();
    if (!form) return { error: "Form cannot be blank." };
    data.form = form;
  }
  if (input.unitPrice !== undefined) {
    const unitPrice = Number(input.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return { error: "Enter a valid unit price." };
    }
    data.unitPrice = unitPrice;
  }
  if (input.costPrice !== undefined) {
    const costPrice = Number(input.costPrice);
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      return { error: "Enter a valid cost price." };
    }
    data.costPrice = costPrice;
  }
  // A stock count sets this branch's shelf; the all-branch total follows.
  let stockDelta = 0;
  let stockBefore = 0;
  let branchId: ID | undefined;
  if (input.stock !== undefined) {
    const stock = Math.round(Number(input.stock));
    if (!Number.isFinite(stock) || stock < 0) {
      return { error: "Stock must be zero or more." };
    }
    branchId = input.branchId ?? (await ensureBranchSetup());
    stockBefore = (await branchStockOf([input.id], branchId)).get(input.id) ?? 0;
    stockDelta = stock - stockBefore;
  }

  // What actually changed, in words, for the inventory log.
  const changes: string[] = [];
  const said = (label: string, from: unknown, to: unknown) => {
    if (to !== undefined && String(from ?? "") !== String(to ?? "")) {
      changes.push(`${label} ${from ?? "—"} → ${to ?? "—"}`);
    }
  };
  said("Name", before.name, data.name);
  said("Strength", before.strength, data.strength);
  said("Form", before.form, data.form);
  said("Cost KSh", before.costPrice, data.costPrice);
  said("Generic", before.genericName, data.genericName);
  said("Barcode", before.barcode, data.barcode);
  said("Reorder level", before.reorderLevel, data.reorderLevel);
  const rxRemoved = before.requiresPrescription === true && data.requiresPrescription === false;
  said("Prescription only", before.requiresPrescription ? "yes" : "no", data.requiresPrescription === undefined ? undefined : data.requiresPrescription ? "yes" : "no");
  const priceChanged = data.unitPrice !== undefined && data.unitPrice !== before.unitPrice;

  const by = { byName: input.changedBy, byId: input.changedById };
  const medicineName = `${data.name ?? before.name} ${data.strength ?? before.strength}`.trim();
  const logBranch = branchId ?? input.branchId ?? null;

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.medicine.update({ where: { id: input.id }, data });
    }
    // Price changes are logged on their own so price cuts stand out.
    if (priceChanged) {
      await logInventoryEvent(tx, {
        type: "price",
        medicineId: input.id,
        medicineName,
        branchId: logBranch,
        details: `Price KSh ${before.unitPrice} → ${data.unitPrice}`,
        flagReason: priceFlag(before.unitPrice, data.unitPrice!, data.costPrice ?? before.costPrice),
        ...by,
      });
    }
    if (changes.length > 0) {
      await logInventoryEvent(tx, {
        type: "edit",
        medicineId: input.id,
        medicineName,
        branchId: logBranch,
        details: changes.join(" · "),
        // Dropping the prescription requirement lets the counter sell it
        // freely — always worth a second look.
        flagReason: rxRemoved ? "Prescription requirement removed" : null,
        ...by,
      });
    }
    if (branchId && stockDelta !== 0) {
      await adjustBranchStock(tx, input.id, branchId, stockDelta, {
        type: "adjust",
        details: `Count set ${stockBefore} → ${stockBefore + stockDelta}`,
        ...by,
      });
    }
  }, SALE_TX_OPTIONS);
}

export async function importMedicines(input: {
  batchId: string;
  items: {
    name: string;
    strength?: string;
    form: string;
    unitPrice: number;
    costPrice?: number;
    stock: number;
  }[];
  mode?: "add_or_update" | "add_only" | "restock_only";
  branchId?: ID; // stamped from the session: whose shelf the stock lands on
  changedBy?: string; // stamped from the session, for the inventory log
  changedById?: ID;
}): Promise<{ added: number; updated: number; error?: string }> {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { added: 0, updated: 0, error: "No items provided in import list." };
  }
  if (typeof input.batchId !== "string" || !input.batchId || input.batchId.length > 100 || input.items.length > 10) {
    return { added: 0, updated: 0, error: "Invalid import batch. Reload the page and try again." };
  }
  for (const item of input.items) {
    if (!item || typeof item.name !== "string" || !item.name.trim() ||
      !Number.isFinite(item.unitPrice) || item.unitPrice < 0 ||
      (item.costPrice !== undefined && (!Number.isFinite(item.costPrice) || item.costPrice < 0)) ||
      !Number.isSafeInteger(item.stock) || item.stock < 0 || item.stock > 2147483647) {
      return { added: 0, updated: 0, error: "An import row has an invalid name, price, or quantity." };
    }
  }
  const branchId = input.branchId ?? (await ensureBranchSetup());
  const receiptId = createHash("sha256").update(JSON.stringify([branchId, input.changedById, input.batchId])).digest("hex");
  const fingerprint = createHash("sha256").update(JSON.stringify([input.mode ?? "add_or_update", input.items])).digest("hex");
  // Match rows to the catalog in memory. A case-insensitive database lookup per
  // row is a pattern search, which is slow inside the transaction and can
  // choke on names with brackets or symbols, e.g. "CEPHALEXIN 100`S (LEOCEF]".
  const key = (name: string, strength: string) => `${name.trim().toLowerCase()}::${strength.trim().toLowerCase()}`;
  const catalog = new Map(
    (await prisma.medicine.findMany({ select: { id: true, name: true, strength: true, unitPrice: true, costPrice: true } }))
      .map((m) => [key(m.name, m.strength), m]),
  );
  try {
    return await importMedicineBatch();
  } catch (err) {
    console.error("importMedicines batch failed", input.batchId, err);
    const names = input.items.map((i) => i.name).slice(0, 3).join(", ");
    return {
      added: 0,
      updated: 0,
      error: `Could not import the batch starting with ${names}${input.items.length > 3 ? "…" : ""}. Nothing from this batch was saved.`,
    };
  }

  function importMedicineBatch() {
    return prisma.$transaction(async (tx) => {
      const receipt = await tx.medicineImportReceipt.findUnique({ where: { id: receiptId } });
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) {
          return { added: 0, updated: 0, error: "This import batch changed. Select the file again to start a new import." };
        }
        return { added: receipt.added, updated: receipt.updated };
      }
      const log = {
        type: "import" as const,
        byName: input.changedBy,
        byId: input.changedById,
        reference: "Bulk import",
      };

      let added = 0;
      let updated = 0;
      const mode = input.mode ?? "add_or_update";

      for (const item of input.items) {
        const name = item.name?.trim();
        if (!name) continue;
        const strength = item.strength?.trim() ?? "";
        const form = item.form?.trim() || "tablet";
        const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
        const costPrice = Math.max(0, Number(item.costPrice) || 0);
        const stockQty = Math.max(0, Math.round(Number(item.stock) || 0));

        const existing = catalog.get(key(name, strength));

        if (existing) {
          if (mode === "add_only") continue;
          const newPrice = unitPrice > 0 ? unitPrice : existing.unitPrice;
          const newCost = costPrice > 0 ? costPrice : existing.costPrice;
          await tx.medicine.update({
            where: { id: existing.id },
            data: { unitPrice: newPrice, costPrice: newCost },
          });
          // A second row for the same medicine in this batch sees these prices.
          catalog.set(key(name, strength), { ...existing, unitPrice: newPrice, costPrice: newCost });
          if (newPrice !== existing.unitPrice) {
            await logInventoryEvent(tx, {
              ...log,
              type: "price",
              medicineId: existing.id,
              medicineName: `${existing.name} ${existing.strength}`.trim(),
              branchId,
              details: `Price KSh ${existing.unitPrice} → ${newPrice} (bulk import)`,
              flagReason: priceFlag(existing.unitPrice, newPrice, newCost),
            });
          }
          await adjustBranchStock(tx, existing.id, branchId, stockQty, log);
          updated++;
        } else {
          if (mode === "restock_only") continue;
          const created = await tx.medicine.create({
            data: { name, strength, form, unitPrice, costPrice, stock: 0 },
          });
          catalog.set(key(name, strength), { id: created.id, name, strength, unitPrice, costPrice });
          await adjustBranchStock(tx, created.id, branchId, stockQty, log);
          added++;
        }
      }

      await tx.medicineImportReceipt.create({ data: { id: receiptId, fingerprint, added, updated } });
      return { added, updated } as { added: number; updated: number; error?: string };
    }, SALE_TX_OPTIONS);
  }
}

/** Empties the medicine catalog — medicines, their batches and per-branch
 *  stock — so a fresh list can be imported. Sales, prescriptions and the
 *  inventory log keep their own copy of each medicine's name. */
export async function clearMedicines(input: {
  confirm?: string;
  changedBy?: string;
  changedById?: ID;
}): Promise<{ removed: number; error?: string }> {
  if (input.confirm !== "DELETE") {
    return { removed: 0, error: 'Type DELETE to confirm clearing the catalog.' };
  }
  const medicines = await prisma.medicine.findMany({
    select: { id: true, name: true, strength: true, stock: true },
  });
  if (medicines.length === 0) return { removed: 0 };

  await prisma.$transaction([
    prisma.inventoryEvent.createMany({
      data: medicines.map((m) => ({
        type: "edit",
        medicineId: m.id,
        medicineName: `${m.name} ${m.strength}`.trim(),
        quantity: -m.stock,
        stockAfter: 0,
        details: `Removed from catalog (catalog cleared, ${m.stock} units on hand)`,
        reference: "Catalog cleared",
        byName: input.changedBy ?? null,
        byId: input.changedById && input.changedById !== "000000000000000000000000" ? input.changedById : null,
        flagged: true,
        flagReason: "Catalog cleared",
      })),
    }),
    prisma.medicineBatch.deleteMany({}),
    prisma.medicineStock.deleteMany({}),
    prisma.medicine.deleteMany({}),
  ]);
  return { removed: medicines.length };
}

export async function startConsult(input: { visitId: ID }) {
  await prisma.visit.update({
    where: { id: input.visitId },
    data: { status: "with-doctor", timeline: stage("with-doctor") },
  });
}

export async function setVisitComplaint(input: {
  visitId: ID;
  complaint: string;
}) {
  await prisma.visit.update({
    where: { id: input.visitId },
    data: { complaint: input.complaint },
  });
}

/** Order a service off the catalog. The title and price come from the catalog
 *  row, never from the client — the same rule the pharmacy POS applies to
 *  medicine prices. */
export async function addServiceOrder(input: {
  visitId: ID;
  serviceItemId: ID;
  instructions?: string;
}): Promise<{ error: string } | void> {
  const item = await prisma.serviceItem.findUnique({
    where: { id: input.serviceItemId },
  });
  if (!item || !item.active) {
    return { error: "That service is no longer in the catalog." };
  }
  const visit = await prisma.visit.findUnique({ where: { id: input.visitId } });
  if (!visit) return { error: "Visit not found." };

  await prisma.order.create({
    data: {
      visitId: input.visitId,
      branchId: visit.branchId, // the lab at the patient's branch runs it
      type: item.orderType,
      title: item.name,
      instructions: input.instructions?.trim() || null,
      status: "requested",
      serviceItemId: item.id,
    },
  });

  // A free service raises no charge, so it never gates the patient.
  const charges =
    item.price > 0
      ? [...visit.charges, newCharge(item.orderType as ChargeType, item.name, item.price)]
      : visit.charges;
  const owesForServices = unpaid(charges).some((c) =>
    SERVICE_CHARGE_TYPES.includes(c.type as ChargeType),
  );
  const status: VisitStatus =
    visit.billingMode === "per-stage" && owesForServices
      ? "awaiting-lab-payment"
      : "awaiting-services";
  await prisma.visit.update({
    where: { id: input.visitId },
    data: { charges: { set: charges }, status, timeline: stage(status) },
  });
}

/** Create a doctor''s complete set of service requests before moving the patient. */
export async function addServiceOrders(input: {
  visitId: ID;
  serviceItemIds: ID[];
  instructions?: string;
}): Promise<{ error: string } | void> {
  const ids = [...new Set(input.serviceItemIds ?? [])];
  if (ids.length === 0) return { error: "Select at least one service." };

  const [visit, items] = await Promise.all([
    prisma.visit.findUnique({ where: { id: input.visitId } }),
    prisma.serviceItem.findMany({ where: { id: { in: ids }, active: true } }),
  ]);
  if (!visit) return { error: "Visit not found." };
  if (items.length !== ids.length) {
    return { error: "One of the selected services is no longer available." };
  }

  await prisma.order.createMany({
    data: items.map((item) => ({
      visitId: input.visitId,
      branchId: visit.branchId, // the lab at the patient's branch runs it
      type: item.orderType,
      title: item.name,
      instructions: input.instructions?.trim() || null,
      status: "requested",
      serviceItemId: item.id,
      results: [],
      meds: [],
    })),
  });

  const charges = items.reduce(
    (all, item) =>
      item.price > 0
        ? [...all, newCharge(item.orderType as ChargeType, item.name, item.price)]
        : all,
    [...visit.charges],
  );
  const owesForServices = unpaid(charges).some((c) =>
    SERVICE_CHARGE_TYPES.includes(c.type as ChargeType),
  );
  const status: VisitStatus =
    visit.billingMode === "per-stage" && owesForServices
      ? "awaiting-lab-payment"
      : "awaiting-services";
  await prisma.visit.update({
    where: { id: input.visitId },
    data: { charges: { set: charges }, status, timeline: stage(status) },
  });
}

/** Take money for some of a visit's outstanding charges — reception's two
 *  pay-gates both come through here. Records one VisitPayment covering the
 *  settled lines, then releases the patient if that clears their gate. */
export async function payCharges(input: {
  visitId: ID;
  chargeIds: ID[];
  method: PaymentMethod;
  reference?: string;
  takenBy?: string;
}): Promise<{ error: string } | void> {
  const visit = await prisma.visit.findUnique({ where: { id: input.visitId } });
  if (!visit) return { error: "Visit not found." };

  // Settle only lines that are still outstanding, so a double-submitted form
  // can never take the same money twice.
  const wanted = new Set(input.chargeIds ?? []);
  const settling = visit.charges.filter((c) => wanted.has(c.id) && !c.paid);
  if (settling.length === 0) {
    return { error: "Those charges have already been paid." };
  }

  const total = totalOf(settling);

  // Same rule as the pharmacy checkout: with PayHero configured, an M-Pesa
  // payment must point at a push we actually saw succeed, for this exact
  // amount. `reference` is the CheckoutRequestID; the receipt replaces it.
  let reference = input.reference?.trim() || undefined;
  if (input.method === "mpesa" && mpesaConfigured()) {
    const tx = reference
      ? await prisma.mpesaTransaction.findUnique({
          where: { checkoutRequestId: reference },
        })
      : null;
    if (!tx) {
      return { error: "Send the M-Pesa request and wait for it to confirm." };
    }
    if (tx.status !== "success") {
      return { error: "The M-Pesa payment has not been confirmed yet." };
    }
    if (tx.amount !== Math.max(1, Math.round(total))) {
      return {
        error:
          "The bill changed after the M-Pesa request. Send a new payment request.",
      };
    }
    if (tx.visitId && tx.visitId !== input.visitId) {
      return { error: "That M-Pesa payment was used for another visit." };
    }
    // A visit pays at more than one gate, so being tied to this visit is not
    // enough — the same push must not settle a second gate for free.
    const alreadySpent = visit.payments.some(
      (p) =>
        p.reference &&
        (p.reference === tx.receipt || p.reference === tx.checkoutRequestId),
    );
    if (alreadySpent) {
      return { error: "That M-Pesa payment was already used on this visit." };
    }
    await prisma.mpesaTransaction.update({
      where: { checkoutRequestId: tx.checkoutRequestId },
      data: { visitId: input.visitId },
    });
    reference = tx.receipt ?? tx.checkoutRequestId;
  }

  const paidAt = new Date();
  const payment = {
    id: crypto.randomUUID(),
    amount: total,
    method: input.method,
    reference: reference ?? null,
    paidAt,
    covers: settling.map((c) => c.id),
    takenBy: input.takenBy ?? null,
  };
  const charges = settleCharges(visit.charges, settling, payment.id, paidAt);

  // Releasing the gate: the patient moves on only once nothing of that kind is
  // still outstanding — a doctor may have ordered three tests and been paid
  // for two.
  const stillOwes = unpaid(charges);
  let status = visit.status as VisitStatus;
  if (
    status === "awaiting-consult-payment" &&
    !stillOwes.some((c) => c.type === "consultation")
  ) {
    status = "awaiting-triage";
  } else if (
    status === "awaiting-lab-payment" &&
    !stillOwes.some((c) => SERVICE_CHARGE_TYPES.includes(c.type as ChargeType))
  ) {
    status = "awaiting-services";
  }

  await prisma.visit.update({
    where: { id: input.visitId },
    data: {
      charges: { set: charges },
      payments: { push: payment },
      ...(status !== visit.status ? { status, timeline: stage(status) } : {}),
    },
  });
}

export async function addPrescription(input: {
  visitId: ID;
  meds: Omit<Med, "id" | "dispensed">[];
}): Promise<{ error: string } | void> {
  const lines = input.meds ?? [];
  if (lines.length === 0) return { error: "Add at least one medicine." };
  // The pharmacy dispenses exactly what is written here, so every line must
  // name a real catalog item and a whole-unit quantity.
  const [catalog, visit] = await Promise.all([
    prisma.medicine.findMany({
      where: { id: { in: lines.map((m) => m.medicineId ?? "").filter(Boolean) } },
      select: { id: true },
    }),
    prisma.visit.findUnique({ where: { id: input.visitId }, select: { branchId: true } }),
  ]);
  if (!visit) return { error: "Visit not found." };
  const known = new Set(catalog.map((m) => m.id));
  for (const m of lines) {
    if (!m.medicineId || !known.has(m.medicineId)) {
      return { error: `Choose ${m.name || "each medicine"} from the pharmacy list.` };
    }
    if (!Number.isInteger(m.quantity) || (m.quantity ?? 0) < 1) {
      return { error: `Enter how many units of ${m.name} to give.` };
    }
  }
  const meds: Med[] = lines.map((m) => ({
    medicineId: m.medicineId,
    name: m.name,
    dosage: m.dosage,
    frequency: m.frequency,
    duration: m.duration,
    quantity: m.quantity,
    id: crypto.randomUUID(),
    dispensed: false,
  }));
  await prisma.order.create({
    data: {
      visitId: input.visitId,
      branchId: visit.branchId, // dispensed by the patient's branch pharmacy
      type: "prescription",
      title: "Prescription",
      status: "requested",
      meds,
    },
  });
}

export async function startServiceOrder(input: { orderId: ID }) {
  await prisma.order.update({
    where: { id: input.orderId },
    data: { status: "in-progress" },
  });
}

/** File a service result. Labs report per-parameter values against the catalog
 *  panel; radiology and procedures report a free-text finding. The low/high
 *  flag is derived here from the catalog's reference range rather than trusted
 *  from the client, so a range correction can't be contradicted by old data. */
export async function completeServiceOrder(input: {
  orderId: ID;
  result?: string;
  results?: LabResult[];
}): Promise<{ error: string } | void> {
  const existing = await prisma.order.findUnique({
    where: { id: input.orderId },
  });
  if (!existing) return { error: "Order not found." };

  const item = existing.serviceItemId
    ? await prisma.serviceItem.findUnique({
        where: { id: existing.serviceItemId },
      })
    : null;
  const requiredParameters = item?.parameters ?? [];
  const submitted = new Map(
    (input.results ?? []).map((result) => [result.parameter, result.value?.trim() ?? ""]),
  );
  if (
    requiredParameters.length > 0 &&
    requiredParameters.some((parameter) => !submitted.get(parameter.name))
  ) {
    return { error: "Complete every required result before returning the patient." };
  }
  const ranges = new Map(requiredParameters.map((p) => [p.name, p]));

  const results = requiredParameters.map((parameter) => {
      const resultValue = submitted.get(parameter.name) ?? "";
      const range = ranges.get(parameter.name);
      const value = Number(resultValue);
      let flag: LabResult["flag"];
      // Qualitative results ("positive") simply carry no flag.
      if (range && Number.isFinite(value)) {
        if (range.refLow != null && value < range.refLow) flag = "low";
        else if (range.refHigh != null && value > range.refHigh) flag = "high";
        else if (range.refLow != null || range.refHigh != null) flag = "normal";
      }
      return { parameter: parameter.name, value: resultValue, flag: flag ?? null };
    });

  const freeText = input.result?.trim();
  if (results.length === 0 && !freeText) {
    return { error: "Enter a result before filing it." };
  }

  const order = await prisma.order.update({
    where: { id: input.orderId },
    data: {
      status: "completed",
      results: { set: results },
      result: freeText || null,
      completedAt: new Date(),
    },
  });
  // Return the patient to the doctor only once every ordered service is done.
  const stillPending = await prisma.order.count({
    where: {
      visitId: order.visitId,
      type: { not: "prescription" },
      status: { not: "completed" },
    },
  });
  if (stillPending === 0) {
    await prisma.visit.update({
      where: { id: order.visitId },
      data: { status: "back-to-doctor", timeline: stage("back-to-doctor") },
    });
  }
}

export async function sendToPharmacy(input: {
  visitId: ID;
}): Promise<{ error: string } | void> {
  const visit = await prisma.visit.findUnique({ where: { id: input.visitId } });
  if (!visit) return { error: "Visit not found." };
  if (visit.status !== "with-doctor" && visit.status !== "back-to-doctor") {
    return { error: "Only a patient who is with the doctor can be sent to the pharmacy." };
  }
  const pendingServices = await prisma.order.count({
    where: {
      visitId: input.visitId,
      type: { not: "prescription" },
      status: { not: "completed" },
    },
  });
  if (pendingServices > 0) {
    return { error: "Wait for every test result before sending the patient on." };
  }
  await prisma.visit.update({
    where: { id: input.visitId },
    data: { status: "awaiting-pharmacy", timeline: stage("awaiting-pharmacy") },
  });
}

export async function toggleMedDispensed(input: {
  orderId: ID;
  medId: ID;
}) {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
  });
  if (!order?.meds) return;
  const meds = (order.meds as Med[]).map((m) =>
    m.id === input.medId ? { ...m, dispensed: !m.dispensed } : m,
  );
  await prisma.order.update({
    where: { id: input.orderId },
    data: { meds: { set: meds } },
  });
}

/** Close a visit with nothing to sell. Only legitimate once the bill is clear
 *  — anything outstanding has to go through the POS so the money is recorded. */
export async function dispenseAndClose(input: {
  visitId: ID;
}): Promise<{ error: string } | void> {
  const visit = await prisma.visit.findUnique({ where: { id: input.visitId } });
  if (!visit) return { error: "Visit not found." };
  const owed = unpaid(visit.charges);
  if (owed.length > 0) {
    return {
      error: `This visit still owes ${totalOf(owed)} — take the payment at the POS to close it.`,
    };
  }
  await prisma.order.updateMany({
    where: { visitId: input.visitId, type: "prescription" },
    data: { status: "completed", completedAt: new Date() },
  });
  await prisma.visit.update({
    where: { id: input.visitId },
    data: { status: "completed", timeline: stage("completed") },
  });
}

/** Pharmacy POS: sell the carted medicines, settle everything still owed on
 *  the visit, and close it. Prices come from the catalog (never the client)
 *  and stock is checked and decremented here.
 *
 *  This is where pay-at-end visits finally pay: the payment covers the carted
 *  medicines *plus* every charge that accumulated earlier (consultation, lab).
 *  In per-stage mode those earlier charges are already settled, so the same
 *  code path just bills the medicines. */
/** How much of each catalog medicine the doctor prescribed on a visit
 *  (medicineId → units). A line without a quantity has no cap. Returns null —
 *  no restriction — when the visit has a legacy prescription line that isn't
 *  tied to a catalog item, since the pharmacist must find those on the shelf. */
export async function prescribedAllowance(visitId: ID): Promise<Map<ID, number> | null> {
  const orders = await prisma.order.findMany({
    where: { visitId, type: "prescription" },
    select: { meds: true },
  });
  const allowance = new Map<ID, number>();
  for (const med of orders.flatMap((o) => o.meds)) {
    if (!med.medicineId) return null;
    const qty = med.quantity ?? Number.POSITIVE_INFINITY;
    allowance.set(med.medicineId, (allowance.get(med.medicineId) ?? 0) + qty);
  }
  return allowance;
}

/** The pharmacy dispenses what the doctor prescribed — it may give less (out
 *  of stock, patient declines) but never something else or more. Returns an
 *  error message, or null when the cart is within the prescription. */
export async function checkPrescribedCart(
  visitId: ID,
  items: { medicineId: ID; quantity: number }[],
): Promise<string | null> {
  const allowance = await prescribedAllowance(visitId);
  if (!allowance) return null;
  const carted = new Map<ID, number>();
  for (const i of items) carted.set(i.medicineId, (carted.get(i.medicineId) ?? 0) + i.quantity);
  for (const [medicineId, qty] of carted) {
    const allowed = allowance.get(medicineId);
    if (allowed === undefined) return "Only medicines the doctor prescribed can be dispensed.";
    if (qty > allowed) return `The doctor prescribed ${allowed} unit(s) — you can't dispense more.`;
  }
  return null;
}

type SaleLine = {
  medicineId: ID;
  name: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
};

/** Price a cart from the catalog (never the client) and check stock — both the
 *  plain count and, where batches exist, that enough of it is still in date.
 *  Also reports which lines are prescription-only, for the walk-in counter. */
async function priceCart(
  items: { medicineId: ID; quantity: number }[],
  branchId: ID, // stock is checked on this branch's shelf
): Promise<
  | { error: string }
  | { saleItems: SaleLine[]; pharmacyCharges: ChargeRow[]; prescriptionOnly: string[] }
> {
  const medicineIds = items.map((i) => i.medicineId);
  const [medicines, batches, onShelf] = await Promise.all([
    prisma.medicine.findMany({ where: { id: { in: medicineIds } } }),
    prisma.medicineBatch.findMany({
      where: { branchId, medicineId: { in: medicineIds }, quantity: { gt: 0 } },
    }),
    branchStockOf(medicineIds, branchId),
  ]);
  const byId = new Map(medicines.map((m) => [m.id, m]));
  // Units in date per medicine, and whether this medicine uses batches at all.
  const now = Date.now();
  const inDate = new Map<ID, number>();
  const batched = new Set<ID>();
  for (const b of batches) {
    batched.add(b.medicineId);
    if (b.expiryDate && b.expiryDate.getTime() < now) continue;
    inDate.set(b.medicineId, (inDate.get(b.medicineId) ?? 0) + b.quantity);
  }

  const saleItems: SaleLine[] = [];
  const prescriptionOnly: string[] = [];
  for (const item of items) {
    const med = byId.get(item.medicineId);
    if (!med) return { error: "A carted medicine no longer exists." };
    const here = onShelf.get(med.id) ?? 0;
    if (here < item.quantity) {
      return {
        error: `Not enough ${med.name} ${med.strength} at this branch (${here} left).`,
      };
    }
    // Expired stock is never sold. Medicines with no batches recorded yet keep
    // working off the plain count, so nothing breaks before batches are used.
    if (batched.has(med.id)) {
      const sellable = inDate.get(med.id) ?? 0;
      if (sellable < item.quantity) {
        return {
          error: `Only ${sellable} unexpired unit(s) of ${med.name} ${med.strength} can be sold (${here - sellable} expired and blocked).`,
        };
      }
    }
    const name = `${med.name} ${med.strength}`.trim();
    if (med.requiresPrescription) prescriptionOnly.push(name);
    saleItems.push({
      medicineId: med.id,
      name,
      quantity: item.quantity,
      unitPrice: med.unitPrice,
      unitCost: med.costPrice,
    });
  }
  // One charge per sale line, settled by this same payment — so a receipt and
  // the visit's bill always tell the same story.
  const pharmacyCharges = saleItems.map((i) =>
    newCharge(
      "pharmacy",
      i.quantity > 1 ? `${i.name} × ${i.quantity}` : i.name,
      i.quantity * i.unitPrice,
    ),
  );
  return { saleItems, pharmacyCharges, prescriptionOnly };
}

/** With Daraja configured, an M-Pesa sale must point at a transaction we
 *  actually saw succeed, for the same amount. `reference` is the
 *  CheckoutRequestID from the STK push; the receipt becomes the reference.
 *  The transaction is tied to `visitId` so it can't pay for a second sale. */
async function claimMpesa(
  method: PaymentMethod,
  rawReference: string | undefined,
  total: number,
  visitId: ID,
): Promise<{ error: string } | { reference: string | undefined }> {
  const reference = rawReference?.trim() || undefined;
  if (method !== "mpesa" || !mpesaConfigured()) return { reference };
  const tx = reference
    ? await prisma.mpesaTransaction.findUnique({
        where: { checkoutRequestId: reference },
      })
    : null;
  if (!tx) {
    return { error: "Send the M-Pesa request and wait for it to confirm." };
  }
  if (tx.status !== "success") {
    return { error: "The M-Pesa payment has not been confirmed yet." };
  }
  if (tx.amount !== Math.max(1, Math.round(total))) {
    return {
      error:
        "The bill changed after the M-Pesa request. Send a new payment request.",
    };
  }
  if (tx.visitId && tx.visitId !== visitId) {
    return { error: "That M-Pesa payment was used for another sale." };
  }
  await prisma.mpesaTransaction.update({
    where: { checkoutRequestId: tx.checkoutRequestId },
    data: { visitId },
  });
  return { reference: tx.receipt ?? tx.checkoutRequestId };
}

export async function checkoutVisit(input: {
  visitId: ID;
  method: PaymentMethod;
  reference?: string;
  items: { medicineId: ID; quantity: number }[];
  takenBy?: string;
  takenByUserId?: ID; // stamped from the session, to find the open till
}): Promise<{ error: string } | { payment: Payment }> {
  const items = (input.items ?? []).map((i) => ({
    medicineId: i.medicineId,
    quantity: Math.max(1, Math.round(i.quantity)),
  }));

  // A retried checkout (e.g. the response got lost after an M-Pesa success)
  // must not sell the cart twice: hand back the payment already recorded.
  const visit = await prisma.visit.findUnique({
    where: { id: input.visitId },
  });
  if (!visit) return { error: "Visit not found." };
  if (visit.status === "completed") {
    if (visit.payment) {
      return {
        payment: {
          amount: visit.payment.amount,
          method: visit.payment.method as PaymentMethod,
          reference: visit.payment.reference ?? undefined,
          paidAt: visit.payment.paidAt.toISOString(),
        },
      };
    }
    return { error: "This visit is already closed." };
  }

  // A patient who was never prescribed anything still has to settle what they
  // ran up on the way through, so an empty cart is fine as long as something
  // is outstanding.
  const outstanding = unpaid(visit.charges);
  if (items.length === 0 && outstanding.length === 0) {
    return { error: "The cart is empty — add at least one medicine." };
  }

  const cartError = await checkPrescribedCart(input.visitId, items);
  if (cartError) return { error: cartError };

  // The medicine leaves the shelf of the branch the patient is at.
  const branchId = visit.branchId ?? (await ensureBranchSetup());
  const priced = await priceCart(items, branchId);
  if ("error" in priced) return priced;
  const { saleItems, pharmacyCharges } = priced;
  const settling = [...outstanding, ...pharmacyCharges];
  const total = totalOf(settling);

  const claim = await claimMpesa(input.method, input.reference, total, input.visitId);
  if ("error" in claim) return claim;
  const reference = claim.reference;

  // One transaction: a failure mid-way must not leave stock decremented
  // without the visit closed (or vice versa), or a retry would sell twice.
  const paidAt = new Date();
  const paymentId = crypto.randomUUID();
  const charges = settleCharges(
    [...visit.charges, ...pharmacyCharges],
    settling,
    paymentId,
    paidAt,
  );
  // Reads happen before the transaction; inside it there are only writes.
  const [shift, fefo] = await Promise.all([
    openShiftOf(input.takenByUserId),
    planFefo(items, branchId),
  ]);
  try {
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      await adjustBranchStock(tx, item.medicineId, branchId, -item.quantity, {
        type: "sale",
        details: "In-house pharmacy (clinic patient)",
        reference: `Visit ${input.visitId}`,
        byName: input.takenBy,
        byId: input.takenByUserId,
      });
    }
    // Clear the earliest-expiring batches first.
    await applyFefo(tx, fefo);
    await tx.order.updateMany({
      where: { visitId: input.visitId, type: "prescription" },
      data: { status: "completed", completedAt: new Date() },
    });
    if (shift) await addToShift(tx, shift.id, input.method, total);
    await tx.visit.update({
      where: { id: input.visitId },
      data: {
        status: "completed",
        timeline: stage("completed"),
        saleItems,
        shiftId: shift?.id ?? null,
        charges: { set: charges },
        payments: {
          push: {
            id: paymentId,
            amount: total,
            method: input.method,
            reference: reference ?? null,
            paidAt,
            covers: settling.map((c) => c.id),
            takenBy: input.takenBy ?? null,
          },
        },
        // Legacy single-payment field, still written so the pre-charges
        // reporting path keeps working for visits closed at the POS.
        payment: {
          set: {
            amount: total,
            method: input.method,
            reference: reference ?? null,
            paidAt,
          },
        },
      },
    });
  }, SALE_TX_OPTIONS);
  } catch (err) {
    if (err instanceof StockChangedError) return { error: STOCK_CHANGED };
    throw err;
  }
  return {
    payment: {
      amount: total,
      method: input.method,
      reference,
      paidAt: paidAt.toISOString(),
    },
  };
}

// --- receiving stock ----------------------------------------------------------

/** Book a delivery in: a batch with its own expiry, added to the medicine's
 *  stock. Selling later draws these down earliest-expiry-first. */
export async function receiveStock(input: {
  medicineId: ID;
  quantity: number;
  batchNumber?: string;
  expiryDate?: string; // "YYYY-MM-DD"
  costPrice?: number;
  notes?: string;
  receivedBy?: string;
  receivedById?: ID;
  branchId?: ID; // stamped from the session: the branch taking delivery
}): Promise<{ error: string } | void> {
  const branchId = input.branchId ?? (await ensureBranchSetup());
  const quantity = Math.round(Number(input.quantity));
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { error: "Enter how many units arrived." };
  }
  const medicine = await prisma.medicine.findUnique({ where: { id: input.medicineId } });
  if (!medicine) return { error: "That medicine is no longer in the catalog." };

  let expiryDate: Date | undefined;
  if (input.expiryDate) {
    const d = new Date(`${input.expiryDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return { error: "Enter a valid expiry date." };
    if (d.getTime() < Date.now()) return { error: "That batch has already expired." };
    expiryDate = d;
  }
  const costPrice =
    input.costPrice === undefined || input.costPrice === null ? undefined : Number(input.costPrice);
  if (costPrice !== undefined && (!Number.isFinite(costPrice) || costPrice < 0)) {
    return { error: "Enter a valid cost price." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.medicineBatch.create({
      data: {
        medicineId: input.medicineId,
        branchId,
        quantity,
        batchNumber: cleanText(input.batchNumber, 60),
        expiryDate: expiryDate ?? null,
        costPrice: costPrice ?? null,
        notes: cleanText(input.notes, 300),
        receivedBy: input.receivedBy ?? null,
        receivedAt: new Date(),
      },
    });
    await adjustBranchStock(tx, input.medicineId, branchId, quantity, {
      type: "receive",
      details: [
        input.batchNumber && `Batch ${input.batchNumber}`,
        expiryDate && `expires ${input.expiryDate}`,
        costPrice !== undefined && `cost KSh ${costPrice}`,
      ]
        .filter(Boolean)
        .join(", ") || "Delivery received",
      byName: input.receivedBy,
      byId: input.receivedById,
    });
    // The latest purchase price is what the next margin should be based on.
    if (costPrice !== undefined) {
      await tx.medicine.update({ where: { id: input.medicineId }, data: { costPrice } });
    }
  }, SALE_TX_OPTIONS);
}

/** Send stock from one branch to another. Batches travel with their batch
 *  number and expiry — earliest-expiring first — so the receiving branch's
 *  expiry tracking stays exact. Stock with no batches moves as a plain count. */
export async function transferStock(input: {
  medicineId: ID;
  fromBranchId: ID;
  toBranchId: ID;
  quantity: number;
  notes?: string;
  byName?: string;
  byId?: ID;
}): Promise<{ error: string } | void> {
  const quantity = Math.round(Number(input.quantity));
  if (!Number.isFinite(quantity) || quantity < 1) return { error: "Enter how many units to send." };
  if (!input.fromBranchId || !input.toBranchId) return { error: "Choose both branches." };
  if (input.fromBranchId === input.toBranchId) return { error: "Pick two different branches." };

  const [medicine, branches, onShelf] = await Promise.all([
    prisma.medicine.findUnique({ where: { id: input.medicineId } }),
    prisma.branch.findMany({ where: { id: { in: [input.fromBranchId, input.toBranchId] } } }),
    branchStockOf([input.medicineId], input.fromBranchId),
  ]);
  if (!medicine) return { error: "That medicine is no longer in the catalog." };
  const to = branches.find((b) => b.id === input.toBranchId);
  if (branches.length !== 2 || !to) return { error: "One of those branches no longer exists." };
  if (!to.active) return { error: `${to.name} is closed — reopen it before sending stock there.` };
  const available = onShelf.get(input.medicineId) ?? 0;
  if (available < quantity) {
    return { error: `Only ${available} unit(s) at the sending branch.` };
  }

  // Which batches move (in-date, earliest expiry first). A medicine without
  // batches produces no plan and moves as a plain count.
  const plan = await planFefo([{ medicineId: input.medicineId, quantity }], input.fromBranchId);
  const batches = await prisma.medicineBatch.findMany({
    where: { id: { in: plan.map((p) => p.batchId) } },
  });
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const hasBatches = await prisma.medicineBatch.count({
    where: { medicineId: input.medicineId, branchId: input.fromBranchId, quantity: { gt: 0 } },
  });
  const planned = plan.reduce((s, p) => s + p.take, 0);
  if (hasBatches > 0 && planned < quantity) {
    return { error: `Only ${planned} in-date unit(s) can be sent — expired stock stays behind.` };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await applyFefo(tx, plan);
      for (const p of plan) {
        const b = batchById.get(p.batchId)!;
        await tx.medicineBatch.create({
          data: {
            medicineId: input.medicineId,
            branchId: input.toBranchId,
            quantity: p.take,
            batchNumber: b.batchNumber,
            expiryDate: b.expiryDate,
            costPrice: b.costPrice,
            receivedBy: input.byName ?? null,
            receivedAt: new Date(),
            notes: `Transferred in${b.receivedAt ? ` (originally received ${b.receivedAt.toISOString().slice(0, 10)})` : ""}`,
          },
        });
      }
      // Counts move between branches; the all-branch total is unchanged.
      const fromName = branches.find((b) => b.id === input.fromBranchId)?.name ?? "another branch";
      const by = { byName: input.byName, byId: input.byId, reference: "Stock transfer" };
      await adjustBranchStock(tx, input.medicineId, input.fromBranchId, -quantity, {
        type: "transfer-out",
        details: `Sent to ${to.name}${input.notes ? ` — ${input.notes}` : ""}`,
        ...by,
      });
      await adjustBranchStock(tx, input.medicineId, input.toBranchId, quantity, {
        type: "transfer-in",
        details: `Received from ${fromName}`,
        ...by,
      });
      await tx.stockTransfer.create({
        data: {
          medicineId: input.medicineId,
          fromBranchId: input.fromBranchId,
          toBranchId: input.toBranchId,
          quantity,
          notes: cleanText(input.notes, 300),
          byName: input.byName ?? null,
        },
      });
    }, SALE_TX_OPTIONS);
  } catch (err) {
    if (err instanceof StockChangedError) return { error: STOCK_CHANGED };
    throw err;
  }
}

/** Write off an expired (or damaged) batch: it leaves the shelf and the
 *  medicine's stock count, and the reason is kept on the batch. */
export async function writeOffBatch(input: {
  batchId: ID;
  reason?: string;
  writtenOffBy?: string;
  writtenOffById?: ID;
}): Promise<{ error: string } | void> {
  const batch = await prisma.medicineBatch.findUnique({ where: { id: input.batchId } });
  if (!batch) return { error: "That batch no longer exists." };
  if (batch.quantity <= 0) return { error: "That batch is already empty." };
  const branchId = batch.branchId ?? (await ensureBranchSetup());
  try {
  await prisma.$transaction(async (tx) => {
    // Only if nothing was sold from the batch since it was read — otherwise
    // the stock count would drop by more than the batch still holds.
    const r = await tx.medicineBatch.updateMany({
      where: { id: batch.id, quantity: batch.quantity },
      data: {
        quantity: 0,
        notes: [
          batch.notes,
          `Written off ${new Date().toISOString().slice(0, 10)}${input.writtenOffBy ? ` by ${input.writtenOffBy}` : ""}${input.reason ? `: ${input.reason}` : ""}`,
        ]
          .filter(Boolean)
          .join(" | ")
          .slice(0, 500),
      },
    });
    if (r.count !== 1) throw new StockChangedError();
    await adjustBranchStock(tx, batch.medicineId, branchId, -batch.quantity, {
      type: "write-off",
      details: [
        batch.batchNumber && `Batch ${batch.batchNumber}`,
        batch.expiryDate && `expiry ${batch.expiryDate.toISOString().slice(0, 10)}`,
        input.reason,
      ]
        .filter(Boolean)
        .join(" · "),
      byName: input.writtenOffBy,
      byId: input.writtenOffById,
    });
  }, SALE_TX_OPTIONS);
  } catch (err) {
    if (err instanceof StockChangedError) {
      return { error: "That batch changed while you were writing it off. Please try again." };
    }
    throw err;
  }
}

// --- till sessions (shifts) ---------------------------------------------------

/** The cashier's open till, if they have one. Sales are attached to it so the
 *  end-of-shift count has something to reconcile against. */
async function openShiftOf(userId?: ID) {
  if (!userId) return null;
  return prisma.shift.findFirst({ where: { cashierId: userId, status: "open" } });
}

/** Add a payment to the running totals of an open till. */
async function addToShift(tx: Tx, shiftId: ID, method: PaymentMethod, amount: number) {
  const field =
    method === "cash" ? "totalCashSales" : method === "mpesa" ? "totalMpesaSales" : "totalCardSales";
  await tx.shift.update({
    where: { id: shiftId },
    data: { [field]: { increment: amount } },
  });
}

export async function openShift(input: {
  openingCash: number;
  openingNotes?: string;
  cashierId?: ID;
  cashierName?: string;
  branchId?: ID; // stamped from the session: whose drawer this is
}): Promise<{ error: string } | void> {
  if (!input.cashierId) return { error: "Sign in again to open a till." };
  const existing = await openShiftOf(input.cashierId);
  if (existing) return { error: "You already have an open till — close it first." };
  const openingCash = Number(input.openingCash);
  if (!Number.isFinite(openingCash) || openingCash < 0) {
    return { error: "Enter the opening cash float." };
  }
  await prisma.shift.create({
    data: {
      cashierId: input.cashierId,
      cashierName: input.cashierName ?? "Cashier",
      branchId: input.branchId ?? (await ensureBranchSetup()),
      openingCash,
      openingNotes: cleanText(input.openingNotes, 300),
      openedAt: new Date(),
    },
  });
}

/** Close the till against a physical cash count. Expected cash is the opening
 *  float plus the cash taken during the session; anything else is a shortage
 *  or an overage, and a session that doesn't balance is flagged for a manager.
 *  M-Pesa is checked too: what the till recorded against what M-Pesa confirmed. */
export async function closeShift(input: {
  closingCashCounted: number;
  closingNotes?: string;
  cashierId?: ID;
}): Promise<{ error: string } | { shift: Shift }> {
  if (!input.cashierId) return { error: "Sign in again to close the till." };
  const shift = await openShiftOf(input.cashierId);
  if (!shift) return { error: "You have no open till." };
  const counted = Number(input.closingCashCounted);
  if (!Number.isFinite(counted) || counted < 0) {
    return { error: "Enter the cash you counted in the drawer." };
  }

  const expected = Math.round((shift.openingCash + shift.totalCashSales) * 100) / 100;
  const difference = Math.round((counted - expected) * 100) / 100;

  // M-Pesa actually confirmed against this till's sales, over its lifetime.
  const confirmed = await prisma.mpesaTransaction.aggregate({
    where: { status: "success", createdAt: { gte: shift.openedAt } },
    _sum: { amount: true },
  });
  const mpesaVariance =
    Math.round(((confirmed._sum.amount ?? 0) - shift.totalMpesaSales) * 100) / 100;

  const balanced = Math.abs(difference) < 0.01;
  const closed = await prisma.shift.update({
    where: { id: shift.id },
    data: {
      status: balanced ? "closed" : "discrepancy",
      closedAt: new Date(),
      closingCashCounted: counted,
      closingNotes: cleanText(input.closingNotes, 300),
      expectedClosingCash: expected,
      cashShortageOverage: difference,
      mpesaVariance,
    },
  });
  return { shift: mapShift(closed) };
}

// --- walk-in pharmacy counter ------------------------------------------------

/** MRN of the one shared patient record every walk-in sale hangs off. */
export const WALK_IN_MRN = "WALK-IN";

/** The shared walk-in patient, created the first time the counter sells. */
async function walkInPatientId(): Promise<ID> {
  const p = await prisma.patient.upsert({
    where: { mrn: WALK_IN_MRN },
    update: {},
    create: {
      mrn: WALK_IN_MRN,
      nationalId: WALK_IN_MRN,
      firstName: "Walk-in",
      lastName: "customer",
      gender: "other",
      age: 0,
      phone: "",
    },
  });
  return p.id;
}

const cleanText = (s: string | undefined, max = 120) => s?.trim().slice(0, max) || null;

/** Over-the-counter sale for someone who came only to buy medicine: no
 *  registration, triage or doctor. Recorded as a closed "walk-in" visit so
 *  stock, reports, accounting and M-Pesa reconciliation all see it exactly
 *  like a clinic sale. Prescription-only medicines need an outside
 *  prescription (prescriber + facility) recorded with the sale. */
export async function sellWalkIn(input: {
  method: PaymentMethod;
  reference?: string;
  items: { medicineId: ID; quantity: number }[];
  customerName?: string;
  customerPhone?: string;
  prescriber?: string;
  prescriberFacility?: string;
  takenBy?: string;
  takenByUserId?: ID; // stamped from the session, to find the open till
  branchId?: ID; // stamped from the session: the counter's branch
}): Promise<{ error: string } | { payment: Payment; visitId: ID }> {
  const branchId = input.branchId ?? (await ensureBranchSetup());
  const items = (input.items ?? [])
    .map((i) => ({ medicineId: i.medicineId, quantity: Math.round(Number(i.quantity)) }))
    .filter((i) => i.quantity > 0);
  if (items.length === 0) return { error: "The cart is empty — add at least one medicine." };
  if (!["cash", "mpesa", "card"].includes(input.method)) {
    return { error: "Choose a payment method." };
  }

  // Chosen up front so the M-Pesa transaction can be tied to this sale.
  let visitId = randomBytes(12).toString("hex");

  // A retried M-Pesa sale (the reply got lost after payment) must not sell
  // twice: if this payment already closed a walk-in sale, hand that back.
  const ref = input.reference?.trim();
  if (input.method === "mpesa" && ref && mpesaConfigured()) {
    const tx = await prisma.mpesaTransaction.findUnique({ where: { checkoutRequestId: ref } });
    if (tx?.visitId) {
      const done = await prisma.visit.findUnique({ where: { id: tx.visitId } });
      // Claimed by an attempt that failed before saving the sale — retry
      // under the same id so the claim still matches.
      if (!done) visitId = tx.visitId;
      else if (done.kind === "walk-in" && done.payment) {
        return {
          visitId: done.id,
          payment: {
            amount: done.payment.amount,
            method: done.payment.method as PaymentMethod,
            reference: done.payment.reference ?? undefined,
            paidAt: done.payment.paidAt.toISOString(),
          },
        };
      }
    }
  }

  const priced = await priceCart(items, branchId);
  if ("error" in priced) return priced;
  const { saleItems, pharmacyCharges, prescriptionOnly } = priced;

  const prescriber = cleanText(input.prescriber);
  const prescriberFacility = cleanText(input.prescriberFacility);
  if (prescriptionOnly.length > 0 && (!prescriber || !prescriberFacility)) {
    return {
      error: `${prescriptionOnly.join(", ")} ${prescriptionOnly.length > 1 ? "are" : "is"} prescription-only — record the prescribing doctor and facility from the customer's prescription.`,
    };
  }

  const total = totalOf(pharmacyCharges);
  const claim = await claimMpesa(input.method, input.reference, total, visitId);
  if ("error" in claim) return claim;

  const paidAt = new Date();
  const paymentId = crypto.randomUUID();
  const charges = settleCharges(pharmacyCharges, pharmacyCharges, paymentId, paidAt);
  // Reads happen before the transaction; inside it there are only writes.
  const [patientId, shift, fefo] = await Promise.all([
    walkInPatientId(),
    openShiftOf(input.takenByUserId),
    planFefo(items, branchId),
  ]);
  try {
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      await adjustBranchStock(tx, item.medicineId, branchId, -item.quantity, {
        type: "sale",
        details: `Community (walk-in)${input.customerName?.trim() ? ` — ${input.customerName.trim().slice(0, 60)}` : ""}${prescriptionOnly.length ? " · Rx recorded" : ""}`,
        reference: `Walk-in sale ${visitId}`,
        byName: input.takenBy,
        byId: input.takenByUserId,
      });
    }
    // Clear the earliest-expiring batches first.
    await applyFefo(tx, fefo);
    if (shift) await addToShift(tx, shift.id, input.method, total);
    await tx.visit.create({
      data: {
        id: visitId,
        patientId,
        kind: "walk-in",
        branchId,
        shiftId: shift?.id ?? null,
        walkIn: {
          customerName: cleanText(input.customerName),
          customerPhone: cleanText(input.customerPhone, 20),
          prescriber: prescriptionOnly.length > 0 ? prescriber : null,
          prescriberFacility: prescriptionOnly.length > 0 ? prescriberFacility : null,
        },
        vitals: EMPTY_VITALS,
        complaint: "",
        status: "completed",
        timeline: [{ status: "completed", at: paidAt }],
        billingMode: "pay-at-end",
        charges,
        saleItems,
        payments: [
          {
            id: paymentId,
            amount: total,
            method: input.method,
            reference: claim.reference ?? null,
            paidAt,
            covers: charges.map((c) => c.id),
            takenBy: input.takenBy ?? null,
          },
        ],
        payment: {
          amount: total,
          method: input.method,
          reference: claim.reference ?? null,
          paidAt,
        },
      },
    });
  }, SALE_TX_OPTIONS);
  } catch (err) {
    if (err instanceof StockChangedError) return { error: STOCK_CHANGED };
    throw err;
  }
  return {
    visitId,
    payment: {
      amount: total,
      method: input.method,
      reference: claim.reference,
      paidAt: paidAt.toISOString(),
    },
  };
}

// --- expenses (admin) --------------------------------------------------------

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "rent",
  "salaries",
  "utilities",
  "supplies",
  "equipment",
  "other",
];

export async function addExpense(input: {
  description: string;
  category: string;
  amount: number;
  date: string; // "YYYY-MM-DD" from the date picker
  recordedById?: ID; // stamped from the session by the API route
  recordedBy?: string;
}): Promise<{ error: string } | void> {
  const description = input.description?.trim();
  if (!description) return { error: "Describe the expense." };

  const category = EXPENSE_CATEGORIES.includes(input.category as ExpenseCategory)
    ? input.category
    : "other";

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter an amount greater than zero." };
  }

  // Stored as the UTC midnight of the picked day, like activity dates.
  const date = new Date(`${input.date}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return { error: "Pick a valid date." };

  await prisma.expense.create({
    data: {
      description,
      category,
      amount,
      date,
      recordedById: input.recordedById || null,
      recordedBy: input.recordedBy || null,
    },
  });
}

/** Save (or replace) the physical cash count for a day. One count per day —
 *  re-entering the same date overwrites it, so a recount just works. */
export async function recordCashCount(input: {
  date: string; // "YYYY-MM-DD" from the date picker
  counted: number;
  notes?: string;
  countedById?: ID; // stamped from the session by the API route
  countedBy?: string;
}): Promise<{ error: string } | void> {
  const counted = Number(input.counted);
  if (!Number.isFinite(counted) || counted < 0) {
    return { error: "Enter the counted cash amount (zero or more)." };
  }
  // Stored as the UTC midnight of the picked day, like expense dates.
  const date = new Date(`${input.date}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return { error: "Pick a valid date." };
  if (date.getTime() > Date.now()) {
    return { error: "You cannot count cash for a future date." };
  }

  await prisma.cashCount.upsert({
    where: { date },
    update: {
      counted,
      notes: input.notes?.trim() || null,
      countedById: input.countedById || null,
      countedBy: input.countedBy || null,
    },
    create: {
      date,
      counted,
      notes: input.notes?.trim() || null,
      countedById: input.countedById || null,
      countedBy: input.countedBy || null,
    },
  });
}

export async function deleteExpense(input: {
  id: ID;
}): Promise<{ error: string } | void> {
  const expense = await prisma.expense.findUnique({ where: { id: input.id } });
  if (!expense) return { error: "Expense not found." };
  await prisma.expense.delete({ where: { id: input.id } });
}

// --- settings --------------------------------------------------------------

/** Update the singleton clinic settings. Missing fields are left untouched;
 *  changing `billingMode` only affects visits opened afterwards (existing
 *  visits keep their snapshotted `billingMode`). */
export async function updateSettings(input: {
  billingMode?: BillingMode;
  consultationFee?: number;
  updatedById?: ID;
}): Promise<{ error: string } | void> {
  if (input.consultationFee !== undefined && input.consultationFee < 0) {
    return { error: "Consultation fee cannot be negative." };
  }
  if (
    input.billingMode !== undefined &&
    input.billingMode !== "per-stage" &&
    input.billingMode !== "pay-at-end"
  ) {
    return { error: "Unknown billing mode." };
  }
  const existing = await prisma.clinicSettings.findFirst();
  const data = {
    ...(input.billingMode !== undefined && { billingMode: input.billingMode }),
    ...(input.consultationFee !== undefined && {
      consultationFee: input.consultationFee,
    }),
    updatedById: input.updatedById ?? null,
  };
  if (existing) {
    await prisma.clinicSettings.update({ where: { id: existing.id }, data });
  } else {
    await prisma.clinicSettings.create({ data });
  }
}

// --- service catalog (admin) ------------------------------------------------

const ORDER_TYPES: ServiceItem["orderType"][] = ["lab", "radiology", "procedure"];

/** Shared validation for both catalog writes. */
function cleanServiceItem(input: {
  name?: string;
  orderType?: string;
  category?: string;
  price?: number;
  parameters?: LabParameter[];
}): { error: string } | {
  name: string;
  orderType: string;
  category: string;
  price: number;
  parameters: LabParameter[];
} {
  const name = (input.name ?? "").trim();
  if (!name) return { error: "Give the service a name." };
  const orderType = (input.orderType ?? "") as ServiceItem["orderType"];
  if (!ORDER_TYPES.includes(orderType)) {
    return { error: "Pick lab, radiology or procedure." };
  }
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) {
    return { error: "Price must be zero or a positive number." };
  }
  // Only labs report against a parameter panel; the others are free-text.
  const parameters =
    orderType === "lab"
      ? (input.parameters ?? [])
          .filter((p) => p.name?.trim())
          .map((p) => ({
            name: p.name.trim(),
            unit: (p.unit ?? "").trim(),
            refLow: Number.isFinite(Number(p.refLow)) ? Number(p.refLow) : null,
            refHigh: Number.isFinite(Number(p.refHigh))
              ? Number(p.refHigh)
              : null,
          }))
      : [];
  return {
    name,
    orderType,
    category: (input.category ?? "other").trim() || "other",
    price: Math.round(price * 100) / 100,
    parameters: parameters as unknown as LabParameter[],
  };
}

export async function addServiceItem(input: {
  name: string;
  orderType: ServiceItem["orderType"];
  category: string;
  price: number;
  parameters?: LabParameter[];
}): Promise<{ error: string } | void> {
  const clean = cleanServiceItem(input);
  if ("error" in clean) return clean;

  // Two rows with the same name would leave the doctor guessing which to order.
  const existing = await prisma.serviceItem.findFirst({
    where: { name: { equals: clean.name, mode: "insensitive" } },
  });
  if (existing) {
    return { error: `"${clean.name}" is already in the catalog.` };
  }
  await prisma.serviceItem.create({ data: clean });
}

/** Edit a catalog entry. Re-pricing never touches charges already raised —
 *  those keep the price that was quoted when the service was ordered. */
export async function updateServiceItem(input: {
  id: ID;
  name: string;
  orderType: ServiceItem["orderType"];
  category: string;
  price: number;
  parameters?: LabParameter[];
  active?: boolean;
}): Promise<{ error: string } | void> {
  const item = await prisma.serviceItem.findUnique({ where: { id: input.id } });
  if (!item) return { error: "Service not found." };
  const clean = cleanServiceItem(input);
  if ("error" in clean) return clean;

  const clash = await prisma.serviceItem.findFirst({
    where: {
      name: { equals: clean.name, mode: "insensitive" },
      id: { not: input.id },
    },
  });
  if (clash) return { error: `"${clean.name}" is already in the catalog.` };

  await prisma.serviceItem.update({
    where: { id: input.id },
    data: {
      ...clean,
      ...(input.active !== undefined && { active: input.active }),
    },
  });
}
