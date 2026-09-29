"use client";

import { useSyncExternalStore } from "react";
import type {
  ClinicData,
  Gender,
  ID,
  LabParameter,
  LabResult,
  Med,
  OrderType,
  Patient,
  PaymentMethod,
  Priority,
  Visit,
  Vitals,
} from "./types";
import { notify } from "./toast";

const EMPTY: ClinicData = {
  doctors: [],
  patients: [],
  visits: [],
  orders: [],
  medicines: [],
  serviceCatalog: [],
  // A placeholder — real settings arrive on the first /api/clinic response.
  settings: {
    id: "",
    billingMode: "per-stage",
    consultationFee: 0,
    updatedAt: new Date(0).toISOString(),
  },
  batches: [],
  branches: [],
  viewBranchId: null,
  canSwitchBranch: false,
  transfers: [],
  myShift: null,
  shifts: [],
  expenses: [],
  cashCounts: [],
  mpesaTransactions: [],
};

let state: ClinicData = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function setData(next: ClinicData) {
  state = next;
  listeners.forEach((l) => l());
}

// Bumped whenever a mutation lands. A background refresh that started before
// then carries older data and must not overwrite the mutation's result.
let version = 0;
let inFlight = false;
// Server cursor from the last response. Once set, refreshes and actions ask
// only for what changed after it instead of the whole clinic.
let cursor: string | undefined;

/** Replace records by id and add new ones. Returns `prev` itself when nothing
 *  actually differs, so an idle refresh doesn't re-render every screen. */
function upsertById<T extends { id: ID }>(prev: T[], changes: T[], newestFirst = false): T[] {
  if (changes.length === 0) return prev;
  const index = new Map(prev.map((item, i) => [item.id, i]));
  const next = [...prev];
  const added: T[] = [];
  let dirty = false;
  for (const item of changes) {
    const i = index.get(item.id);
    if (i === undefined) {
      added.push(item);
      dirty = true;
    } else if (JSON.stringify(next[i]) !== JSON.stringify(item)) {
      next[i] = item;
      dirty = true;
    }
  }
  if (!dirty) return prev;
  return newestFirst ? [...added.reverse(), ...next] : [...next, ...added];
}

/** Fields merged record-by-record, plus sync bookkeeping. */
const INCREMENTAL_KEYS = new Set([
  "patients",
  "visits",
  "orders",
  "mpesaTransactions",
  "syncedAt",
  "partial",
]);

/** Everything in the dataset that arrives whole on every response. */
function wholeParts(d: ClinicData): Record<string, unknown> {
  return Object.fromEntries(Object.entries(d).filter(([k]) => !INCREMENTAL_KEYS.has(k)));
}

/** Adopt a server response: a full dataset replaces everything; a partial one
 *  is merged into what the screen already has. */
function mergeData(prev: ClinicData, next: ClinicData): ClinicData {
  cursor = next.syncedAt;
  if (!next.partial) return next;
  const patients = upsertById(prev.patients, next.patients);
  const visits = upsertById(prev.visits, next.visits);
  const orders = upsertById(prev.orders, next.orders);
  const mpesaTransactions = upsertById(prev.mpesaTransactions, next.mpesaTransactions, true);
  // Small tables always arrive whole.
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  // Everything outside the four incremental lists arrives whole each time —
  // any of it changing (a till opened, a batch received, the branch switched)
  // has to reach the screen, so compare all of it, not a hand-picked few.
  const smallSame = same(wholeParts(prev), wholeParts(next));
  if (
    smallSame &&
    patients === prev.patients &&
    visits === prev.visits &&
    orders === prev.orders &&
    mpesaTransactions === prev.mpesaTransactions
  ) {
    return prev;
  }
  return {
    ...next,
    patients,
    visits,
    orders,
    mpesaTransactions,
    partial: undefined,
  };
}

function adopt(next: ClinicData): ClinicData {
  const merged = mergeData(state, next);
  if (merged !== state) setData(merged);
  return merged;
}

async function hydrate() {
  if (inFlight) return;
  inFlight = true;
  const startedAt = version;
  try {
    const url = cursor ? `/api/clinic?since=${encodeURIComponent(cursor)}` : "/api/clinic";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return;
    const data: ClinicData = await res.json();
    // An action landed meanwhile with newer data — this reply is stale.
    if (startedAt !== version) return;
    adopt(data);
  } catch (err) {
    console.error("Failed to load clinic data", err);
  } finally {
    inFlight = false;
  }
}

// Stations hand patients to each other (reception → doctor → lab → pharmacy),
// so every open screen re-checks the server regularly and whenever the tab
// comes back into view — nobody has to reload to see a newly arrived patient.
const POLL_MS = 8000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const refreshIfVisible = () => {
  if (document.visibilityState === "visible") void hydrate();
};

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(refreshIfVisible, POLL_MS);
  document.addEventListener("visibilitychange", refreshIfVisible);
  window.addEventListener("focus", refreshIfVisible);
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
  document.removeEventListener("visibilitychange", refreshIfVisible);
  window.removeEventListener("focus", refreshIfVisible);
}

type ActResult = { data: ClinicData | null; error: string | null };

const ACTION_SUCCESS_MESSAGES: Record<string, string> = {
  registerPatient: "Patient registered and checked in.",
  startVisit: "Patient checked in.",
  recordTriage: "Triage saved and patient sent to doctor.",
  assignVisitDoctor: "Doctor assignment updated.",
  startConsult: "Consultation started.",
  setVisitComplaint: "Complaint saved.",
  addServiceOrder: "Service order added.",
  addPrescription: "Prescription saved.",
  startServiceOrder: "Service order marked in progress.",
  completeServiceOrder: "Result saved and patient returned to doctor.",
  sendToPharmacy: "Patient sent to pharmacy.",
  toggleMedDispensed: "Medicine status updated.",
  dispenseAndClose: "Visit closed.",
  checkoutVisit: "Payment recorded and visit closed.",
  sellWalkIn: "Walk-in sale recorded.",
  openShift: "Till opened.",
  closeShift: "Till closed.",
  receiveStock: "Stock received.",
  writeOffBatch: "Batch written off.",
  transferStock: "Stock transferred.",
  payCharges: "Payment recorded.",
  addMedicine: "Medicine added to catalog.",
  updateMedicine: "Medicine updated.",
  importMedicines: "Bulk inventory import completed.",
  clearMedicines: "Medicine catalog cleared.",
  addServiceItem: "Service added to catalog.",
  updateServiceItem: "Service updated.",
  addExpense: "Expense recorded.",
  deleteExpense: "Expense deleted.",
  recordCashCount: "Cash count saved.",
  updateSettings: "Settings updated.",
};

/** Send a mutation, adopt the fresh dataset, and return it so callers can pick
 *  up server-generated values (e.g. a new visit's id) or a rejection message
 *  (e.g. the chosen doctor is already busy → HTTP 409). */
async function act(
  action: string,
  payload?: unknown,
  opts: { quiet?: boolean } = {},
): Promise<ActResult> {
  try {
    const res = await fetch("/api/clinic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload, since: cursor }),
    });
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const error = body.error ?? "Action rejected";
      notify("error", error);
      return { data: null, error };
    }
    if (!res.ok) {
      console.error(`Action ${action} failed`, await res.text());
      notify("error", "Action failed.");
      return { data: null, error: "Action failed" };
    }
    version++;
    // Callers read the result (e.g. to find the visit just created), so hand
    // back the complete merged dataset, not the partial reply.
    const data = adopt((await res.json()) as ClinicData);
    const message = ACTION_SUCCESS_MESSAGES[action];
    if (message && !opts.quiet) notify("success", message);
    return { data, error: null };
  } catch (err) {
    console.error(`Action ${action} failed`, err);
    notify("error", "Network error. Please try again.");
    return { data: null, error: "Network error" };
  }
}

// --- React binding ---------------------------------------------------------

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!loaded) {
    loaded = true;
    void hydrate();
  }
  startPolling();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) stopPolling();
  };
}

export function useClinic(): ClinicData {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

export function refresh() {
  return hydrate();
}

/** Admins: look at another branch (or "all"). Every list on screen belongs to
 *  the old branch, so the whole dataset is reloaded rather than merged. */
export async function switchBranch(branchId: ID | "all") {
  const res = await fetch("/api/branches", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branchId }),
  });
  if (!res.ok) {
    notify("error", "Could not switch branch.");
    return;
  }
  cursor = undefined;
  version++; // any refresh still in flight belongs to the old branch
  inFlight = false;
  await hydrate();
}

// Pick the most recently created open visit for a patient out of a dataset.
function latestOpenVisit(data: ClinicData, patientId: ID): Visit | undefined {
  return [...data.visits]
    .reverse()
    .find((v) => v.patientId === patientId && v.status !== "completed");
}

// --- actions ---------------------------------------------------------------

/** Returns the patient & visit the server created, so reception can chain a
 *  triage write against the new visit. */
export async function registerPatient(input: {
  nationalId: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  age: number;
  phone: string;
  assignedDoctorId?: ID;
}): Promise<
  { error: string } | { patient: Patient; visit: Visit | undefined }
> {
  const { data, error } = await act("registerPatient", input);
  if (error) return { error };
  if (!data) return { error: "Registration failed" };
  const patient = [...data.patients]
    .reverse()
    .find((p) => p.nationalId === input.nationalId);
  if (!patient) return { error: "Registration failed" };
  return { patient, visit: latestOpenVisit(data, patient.id) };
}

/** Returns the newly created visit so reception can record triage against it. */
export async function startVisit(
  patientId: ID,
  assignedDoctorId?: ID,
): Promise<{ error: string } | { visit: Visit | undefined }> {
  const { data, error } = await act("startVisit", {
    patientId,
    assignedDoctorId,
  });
  if (error) return { error };
  if (!data) return { error: "Check-in failed" };
  return { visit: latestOpenVisit(data, patientId) };
}

export function recordTriage(visitId: ID, vitals: Vitals, priority: Priority) {
  return act("recordTriage", { visitId, vitals, priority });
}

/** Returns an error message if the doctor is already busy, else null. */
export async function assignVisitDoctor(visitId: ID, doctorId: ID) {
  const { error } = await act("assignVisitDoctor", { visitId, doctorId });
  return error;
}

export function startConsult(visitId: ID) {
  return act("startConsult", { visitId });
}

export function setVisitComplaint(visitId: ID, complaint: string) {
  return act("setVisitComplaint", { visitId, complaint });
}

/** Order a service off the catalog. The title and price are resolved from the
 *  catalog server-side — the client only says which item. */
export async function addServiceOrder(
  visitId: ID,
  serviceItemId: ID,
  instructions?: string,
) {
  const { error } = await act("addServiceOrder", {
    visitId,
    serviceItemId,
    instructions,
  });
  return error;
}

/** Send every selected lab/radiology/procedure request as one clinical handoff. */
export async function addServiceOrders(
  visitId: ID,
  serviceItemIds: ID[],
  instructions?: string,
) {
  const { error } = await act("addServiceOrders", {
    visitId,
    serviceItemIds,
    instructions,
  });
  return error;
}

export function addPrescription(
  visitId: ID,
  meds: Omit<Med, "id" | "dispensed">[],
) {
  return act("addPrescription", { visitId, meds });
}

/** File a result: labs send `results` (one entry per catalog parameter),
 *  radiology and procedures send free-text `result`. */
export async function completeServiceOrder(
  orderId: ID,
  input: { result?: string; results?: LabResult[] },
) {
  const { error } = await act("completeServiceOrder", { orderId, ...input });
  return error;
}

export function startServiceOrder(orderId: ID) {
  return act("startServiceOrder", { orderId });
}

export function sendToPharmacy(visitId: ID) {
  return act("sendToPharmacy", { visitId });
}

export function toggleMedDispensed(orderId: ID, medId: ID) {
  return act("toggleMedDispensed", { orderId, medId });
}

export function dispenseAndClose(visitId: ID) {
  return act("dispenseAndClose", { visitId });
}

/** Add a medicine to the pharmacy catalog. Returns an error message on
 *  rejection (e.g. duplicate name+strength), else null. */
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
}) {
  const { error } = await act("addMedicine", input);
  return error;
}

/** Update a catalog medicine's prices and/or stock. Returns an error message
 *  on rejection, else null. */
export async function updateMedicine(
  id: ID,
  changes: {
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
  },
) {
  const { error } = await act("updateMedicine", { id, ...changes });
  return error;
}

/** Bulk import an array of medicines parsed from Excel/CSV. Large files are
 *  sent in chunks by the caller; `quiet` skips the toast for all but the last. */
export async function importMedicines(
  input: {
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
  },
  opts: { quiet?: boolean } = {},
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("/api/clinic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "importMedicines", payload: input }),
      });
      const body = await res.json().catch(() => null) as { added?: number; updated?: number; error?: string } | null;
      if (res.ok && typeof body?.added === "number" && typeof body.updated === "number") {
        version++;
        if (!opts.quiet) {
          notify("success", "Bulk inventory import completed.");
          void hydrate();
        }
        return { added: body.added, updated: body.updated, error: null };
      }
      if (res.status < 500 && res.status !== 429 && res.status !== 408) {
        return { added: 0, updated: 0, error: body?.error ?? `Import rejected (${res.status}).` };
      }
      if (attempt === 2) {
        return { added: 0, updated: 0, error: `The server could not finish this batch (${res.status}).` };
      }
    } catch (err) {
      console.error("Import request failed", err);
      if (attempt === 2) return { added: 0, updated: 0, error: "Connection interrupted." };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  return { added: 0, updated: 0, error: "Import interrupted." };
}

/** Delete every catalog medicine with its batches and branch stock (admin
 *  only). `confirm` must be "DELETE". Returns an error message, else null. */
export async function clearMedicines(confirm: string) {
  const { error } = await act("clearMedicines", { confirm });
  return error;
}

/** Record a running cost (rent, salaries…) for the P&L report. Returns an
 *  error message on rejection, else null. */
export async function addExpense(input: {
  description: string;
  category: string;
  amount: number;
  date: string; // "YYYY-MM-DD"
}) {
  const { error } = await act("addExpense", input);
  return error;
}

export async function deleteExpense(id: ID) {
  const { error } = await act("deleteExpense", { id });
  return error;
}

/** Save (or replace) the physical cash count for a day. Returns an error
 *  message on rejection, else null. */
export async function recordCashCount(input: {
  date: string; // "YYYY-MM-DD"
  counted: number;
  notes?: string;
}) {
  const { error } = await act("recordCashCount", input);
  return error;
}

/** Admin: change the clinic-wide billing mode and/or consultation fee. New
 *  visits pick up the change; in-flight visits keep their snapshotted mode. */
export async function updateSettings(input: {
  billingMode?: "per-stage" | "pay-at-end";
  consultationFee?: number;
}) {
  const { error } = await act("updateSettings", input);
  return error;
}

/** Take money for outstanding charges at one of reception's pay-gates. The
 *  patient is released automatically once the gate is clear. */
export async function payCharges(input: {
  visitId: ID;
  chargeIds: ID[];
  method: PaymentMethod;
  reference?: string;
}) {
  const { error } = await act("payCharges", input);
  return error;
}

/** Admin: add a lab / radiology / procedure to the priced catalog. */
export async function addServiceItem(input: {
  name: string;
  orderType: Exclude<OrderType, "prescription">;
  category: string;
  price: number;
  parameters?: LabParameter[];
}) {
  const { error } = await act("addServiceItem", input);
  return error;
}

/** Admin: edit a catalog entry. Charges already raised keep their old price. */
export async function updateServiceItem(input: {
  id: ID;
  name: string;
  orderType: Exclude<OrderType, "prescription">;
  category: string;
  price: number;
  parameters?: LabParameter[];
  active?: boolean;
}) {
  const { error } = await act("updateServiceItem", input);
  return error;
}

/** Pharmacy POS: sell the carted medicines, settle everything still owed on
 *  the visit, and close it. Returns an error message on rejection, else null. */
export async function checkoutVisit(
  visitId: ID,
  method: PaymentMethod,
  reference: string,
  items: { medicineId: ID; quantity: number }[],
) {
  const { error } = await act("checkoutVisit", {
    visitId,
    method,
    reference,
    items,
  });
  return error;
}

/** Walk-in counter: sell over the counter with no clinic visit. Returns an
 *  error message on rejection, else null. */
export async function sellWalkIn(input: {
  method: PaymentMethod;
  reference?: string;
  items: { medicineId: ID; quantity: number }[];
  customerName?: string;
  customerPhone?: string;
  prescriber?: string;
  prescriberFacility?: string;
}) {
  const { error } = await act("sellWalkIn", input);
  return error;
}

/** Open this cashier's till with a cash float. */
export async function openShift(openingCash: number, openingNotes?: string) {
  const { error } = await act("openShift", { openingCash, openingNotes });
  return error;
}

/** Close the till against a counted drawer. Returns the reconciliation (or an
 *  error message) so the cashier sees the shortage/overage straight away. */
export async function closeShift(closingCashCounted: number, closingNotes?: string) {
  const { data, error } = await act("closeShift", {
    closingCashCounted,
    closingNotes,
  });
  if (error) return { error };
  // The closed till is the newest one in the refreshed list.
  return { shift: data?.shifts?.[0] ?? null };
}

/** Book a delivery into stock as a batch with its own expiry date. */
export async function receiveStock(input: {
  medicineId: ID;
  quantity: number;
  batchNumber?: string;
  expiryDate?: string;
  costPrice?: number;
  notes?: string;
}) {
  const { error } = await act("receiveStock", input);
  return error;
}

/** Send stock from one branch to another (batches keep their expiry). */
export async function transferStock(input: {
  medicineId: ID;
  fromBranchId: ID;
  toBranchId: ID;
  quantity: number;
  notes?: string;
}) {
  const { error } = await act("transferStock", input);
  return error;
}

/** Take an expired or damaged batch off the shelf. */
export async function writeOffBatch(batchId: ID, reason?: string) {
  const { error } = await act("writeOffBatch", { batchId, reason });
  return error;
}
