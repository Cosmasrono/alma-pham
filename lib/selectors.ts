// Read-only helpers for deriving views from the clinic dataset.
// These are pure functions, easy to unit test, and keep the components clean.

import type {
  Charge,
  ClinicData,
  Doctor,
  ID,
  Order,
  Patient,
  Priority,
  Visit,
  VisitPayment,
  VisitStatus,
} from "./types";

// A visit sits in its doctor's queue from assignment until the consult is
// finished (patient sent to pharmacy) or the visit is closed. Queues are
// unbounded — reception balances load using the counts shown in the picker.
export const OCCUPYING_STATUSES: VisitStatus[] = [
  "awaiting-triage",
  // A patient held at a pay-gate is still in the clinic and still that
  // doctor's — leaving these out would quietly shrink their queue count.
  "awaiting-consult-payment",
  "waiting",
  "with-doctor",
  "awaiting-lab-payment",
  "awaiting-services",
  "back-to-doctor",
];

// The department the patient is physically in right now. This is what staff
// see as the patient's "status"; the finer-grained VisitStatus stays internal
// to drive the workflow.
export type VisitLocation =
  | "reception"
  | "consultation"
  | "lab"
  | "radiology"
  | "procedure"
  | "pharmacy"
  | "completed";

export const LOCATION_LABELS: Record<VisitLocation, string> = {
  reception: "Reception",
  consultation: "In consultation",
  lab: "In lab",
  radiology: "In radiology",
  procedure: "In procedure",
  pharmacy: "In pharmacy",
  completed: "Completed",
};

/** Where is this patient right now? A visit sent for services resolves to the
 *  department of its first still-pending order (lab before radiology before
 *  procedure — the order patients typically move through them). */
export function visitLocation(data: ClinicData, visit: Visit): VisitLocation {
  switch (visit.status) {
    case "awaiting-triage":
    // Consultation and lab pay-gates are physically at the cashier /
    // reception desk — the patient hasn't moved on yet.
    case "awaiting-consult-payment":
    case "awaiting-lab-payment":
      return "reception";
    // "waiting" = triage finished and the patient was sent to the doctor's
    // queue — staff see them at consultation from that moment.
    case "waiting":
    case "with-doctor":
    case "back-to-doctor":
      return "consultation";
    case "awaiting-services": {
      const pending = data.orders.filter(
        (o) =>
          o.visitId === visit.id &&
          o.type !== "prescription" &&
          o.status !== "completed",
      );
      if (pending.some((o) => o.type === "lab")) return "lab";
      if (pending.some((o) => o.type === "radiology")) return "radiology";
      return "procedure";
    }
    case "awaiting-pharmacy":
      return "pharmacy";
    case "completed":
      return "completed";
  }
}

// --- billing ----------------------------------------------------------------

/** The two statuses where a patient is held until they pay. */
export const PAY_GATE_STATUSES: VisitStatus[] = [
  "awaiting-consult-payment",
  "awaiting-lab-payment",
];

/** Charges still owed on this visit, oldest first. */
export function outstandingCharges(visit: Visit): Charge[] {
  return (visit.charges ?? []).filter((c) => !c.paid);
}

export function chargesTotal(charges: Charge[]): number {
  return Math.round(charges.reduce((s, c) => s + c.amount, 0) * 100) / 100;
}

/** What this visit still owes, all stages combined. */
export function outstandingTotal(visit: Visit): number {
  return chargesTotal(outstandingCharges(visit));
}

/** Every payment taken on a visit. Visits closed before per-stage billing
 *  existed only have the single legacy `payment`, so fall back to it — that
 *  keeps historical revenue reporting identical. */
export function paymentsOf(visit: Visit): VisitPayment[] {
  if (visit.payments?.length) return visit.payments;
  if (!visit.payment) return [];
  return [
    {
      id: visit.id,
      amount: visit.payment.amount,
      method: visit.payment.method,
      reference: visit.payment.reference,
      paidAt: visit.payment.paidAt,
      covers: [],
    },
  ];
}

/** Visits waiting at a cashier gate, oldest first — reception's payment queue. */
export function visitsAwaitingPayment(data: ClinicData): Visit[] {
  return data.visits
    .filter((v) => PAY_GATE_STATUSES.includes(v.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// --- visit timing -----------------------------------------------------------

/** A stay is flagged once the patient has been in the clinic this long. */
export const LONG_STAY_MS = 60 * 60 * 1000; // 1 hour → amber
export const VERY_LONG_STAY_MS = 2 * 60 * 60 * 1000; // 2 hours → red

export interface VisitTiming {
  totalMs: number; // reception check-in → completed (or → now while open)
  stageMs: number; // time spent in the current status
  done: boolean;
}

/** How long this visit has taken, measured from the reception check-in. */
export function visitTiming(visit: Visit, nowMs = Date.now()): VisitTiming {
  const start = new Date(visit.createdAt).getTime();
  const timeline = visit.timeline ?? [];
  const done = visit.status === "completed";
  const completedAt = timeline.find((e) => e.status === "completed")?.at;
  const end = done
    ? new Date(completedAt ?? visit.updatedAt).getTime()
    : nowMs;
  const lastChange = timeline.length
    ? new Date(timeline[timeline.length - 1].at).getTime()
    : start;
  return {
    totalMs: Math.max(0, end - start),
    stageMs: Math.max(0, end - lastChange),
    done,
  };
}

/** "45m", "1h 20m", "2d 3h" — coarse on purpose; staff scan these. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** How many patients each doctor currently has in their queue (optionally
 *  ignoring one visit, e.g. the one being reassigned). */
export function doctorQueueCounts(
  data: ClinicData,
  excludeVisitId?: ID,
): Map<ID, number> {
  const occupying = new Set<VisitStatus>(OCCUPYING_STATUSES);
  const counts = new Map<ID, number>();
  for (const v of data.visits) {
    if (v.id === excludeVisitId) continue;
    if (v.assignedDoctorId && occupying.has(v.status)) {
      counts.set(v.assignedDoctorId, (counts.get(v.assignedDoctorId) ?? 0) + 1);
    }
  }
  return counts;
}

export function patientMap(data: ClinicData): Map<ID, Patient> {
  return new Map(data.patients.map((p) => [p.id, p]));
}

export function doctorMap(data: ClinicData): Map<ID, Doctor> {
  return new Map(data.doctors.map((d) => [d.id, d]));
}

export function doctorName(d?: Doctor) {
  return d ? d.name : "Unassigned";
}

export function patientName(p?: Patient) {
  return p ? `${p.firstName} ${p.lastName}` : "Unknown patient";
}

/** A pharmacy counter sale, not a patient's clinic visit. It counts towards
 *  revenue and stock, but never towards visits, patients or visit times. */
export function isWalkIn(v: Visit): boolean {
  return v.kind === "walk-in";
}

/** Where a sale came from: the community pharmacy's walk-in counter, or the
 *  in-house pharmacy serving a clinic patient. */
export type SaleSource = "community" | "in-house";

export const SALE_SOURCE_LABELS: Record<SaleSource, string> = {
  community: "Community pharmacy",
  "in-house": "In-house (clinic)",
};

export function saleSource(v: Visit): SaleSource {
  return isWalkIn(v) ? "community" : "in-house";
}

/** Clinic visits only — walk-in counter sales left out. */
export function clinicVisits(data: ClinicData): Visit[] {
  return data.visits.filter((v) => !isWalkIn(v));
}

/** Who a visit's money came from, for sales lists: the patient, or the
 *  walk-in customer (who is not a registered patient). */
export function payerName(patients: Map<ID, Patient>, v: Visit): string {
  if (isWalkIn(v)) {
    const name = v.walkIn?.customerName?.trim();
    return name ? `Walk-in: ${name}` : "Walk-in customer";
  }
  return patientName(patients.get(v.patientId));
}

export function visitsByStatus(data: ClinicData, ...statuses: Visit["status"][]) {
  const set = new Set(statuses);
  return data.visits
    .filter((v) => set.has(v.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function ordersForVisit(data: ClinicData, visitId: ID): Order[] {
  return data.orders.filter((o) => o.visitId === visitId);
}

/** Look up a patient by their national ID (exact, case-insensitive). */
export function findPatientByNationalId(
  data: ClinicData,
  nationalId: string,
): Patient | undefined {
  const id = nationalId.trim().toLowerCase();
  if (!id) return undefined;
  return data.patients.find(
    (p) => (p.nationalId ?? "").trim().toLowerCase() === id,
  );
}

/** All visits for one patient, newest first — their history. */
export function visitsForPatient(data: ClinicData, patientId: ID): Visit[] {
  return data.visits
    .filter((v) => v.patientId === patientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Free-text search across name, national ID and MRN. */
export function searchPatients(data: ClinicData, query: string): Patient[] {
  const q = query.trim().toLowerCase();
  if (!q) return data.patients;
  return data.patients.filter((p) =>
    [p.firstName, p.lastName, `${p.firstName} ${p.lastName}`, p.nationalId, p.mrn]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
}

const PRIORITY_RANK: Record<Priority, number> = {
  emergency: 0,
  urgent: 1,
  normal: 2,
};

/** Sort comparator: higher priority first, then earliest arrival. */
export function byPriorityThenArrival(a: Visit, b: Visit): number {
  const ra = a.priority ? PRIORITY_RANK[a.priority] : PRIORITY_RANK.normal;
  const rb = b.priority ? PRIORITY_RANK[b.priority] : PRIORITY_RANK.normal;
  return ra - rb || a.createdAt.localeCompare(b.createdAt);
}

export function openServiceOrders(
  data: ClinicData,
  type?: Order["type"],
): { order: Order; visit?: Visit; patient?: Patient }[] {
  const pmap = patientMap(data);
  const vmap = new Map(data.visits.map((v) => [v.id, v]));
  return data.orders
    .filter(
      (o) =>
        o.type !== "prescription" &&
        o.status !== "completed" &&
        (!type || o.type === type),
    )
    .map((order) => {
      const visit = vmap.get(order.visitId);
      return { order, visit, patient: visit && pmap.get(visit.patientId) };
    })
    // In per-stage mode the patient is still at the cashier — the test isn't
    // authorised yet, so it must not appear on the technician's bench.
    .filter(({ visit }) => visit?.status !== "awaiting-lab-payment");
}
