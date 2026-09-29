// Domain model for the clinic/hospital management system.
//
// These types are storage-agnostic on purpose. Today they are persisted in
// localStorage (see store.ts); later the exact same shapes map to Prisma
// models backed by MongoDB. Keeping the domain here means the UI never has to
// change when the storage engine does.

export type ID = string;

/** Where the patient physically is in their journey right now. */
export type VisitStatus =
  | "awaiting-triage" // registered, nurse to take vitals
  | "awaiting-consult-payment" // per-stage mode: pay consultation fee before doctor
  | "waiting" // triaged (and paid, if per-stage), waiting for the doctor
  | "with-doctor" // doctor is consulting
  | "awaiting-lab-payment" // per-stage mode: pay for ordered lab tests
  | "awaiting-services" // paid (or pay-at-end): lab/radiology/procedure runs
  | "back-to-doctor" // services done, doctor reviews results
  | "awaiting-pharmacy" // doctor finalized, meds to dispense
  | "completed"; // visit closed

/** Triage priority set by the nurse. Drives ordering of the doctor queue. */
export type Priority = "normal" | "urgent" | "emergency";

/** The kinds of work a doctor can order during a visit. */
export type OrderType = "lab" | "radiology" | "procedure" | "prescription";

export type OrderStatus = "requested" | "in-progress" | "completed";

export type Gender = "male" | "female" | "other";

/** One step of a visit's journey — when it entered each status. */
export interface StageEvent {
  status: VisitStatus;
  at: string;
}

export interface Patient {
  id: ID;
  mrn: string; // human-friendly medical record number, e.g. "P-0001"
  nationalId: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  age: number;
  phone: string;
  registeredById?: ID; // staff member who onboarded them
  createdAt: string;
}

/** Vitals are taken at reception and belong to the visit (they change every
 *  time the patient comes in). Stored as strings so fields can be left blank. */
export interface Vitals {
  weight: string; // kg
  temperature: string; // °C
  bloodPressure: string; // e.g. "120/80"
}

/** A member of staff in a department. Kept minimal for now (no login yet) —
 *  this grows into a full User with role + credentials later. */
export interface Doctor {
  id: ID;
  name: string;
}

export interface Visit {
  id: ID;
  patientId: ID;
  vitals: Vitals; // captured at the triage station
  priority?: Priority; // set at triage
  complaint: string; // recorded by the doctor during consultation
  assignedDoctorId?: ID; // which doctor this visit is routed to
  status: VisitStatus;
  timeline?: StageEvent[]; // timestamped status history, check-in → completed
  /** Snapshotted at check-in — a mid-visit toggle on the clinic settings must
   *  not retroactively change how this visit is charged. */
  billingMode: BillingMode;
  charges: Charge[]; // every billable line accumulated during the visit
  payments: VisitPayment[]; // every payment event on the visit
  payment?: Payment; // legacy: single lump payment (old records only)
  saleItems?: SaleItem[]; // what the pharmacy actually sold at checkout
  /** "walk-in": a pharmacy counter sale with no clinic journey. Attached to
   *  the shared walk-in patient, so it is not a real patient visit. */
  kind?: "walk-in";
  walkIn?: WalkInInfo;
  shiftId?: ID; // till session that took the money
  branchId?: ID; // clinic location it happened at
  createdAt: string;
  updatedAt: string;
}

/** Details captured at the walk-in counter — all optional. The prescriber
 *  fields record the outside prescription behind any prescription-only item. */
export interface WalkInInfo {
  customerName?: string;
  customerPhone?: string;
  prescriber?: string;
  prescriberFacility?: string;
}

/** A single prescribed medicine line (what the doctor wrote). */
export interface Med {
  id: ID;
  medicineId?: ID; // exact pharmacy catalog item; absent on legacy records
  name: string;
  dosage: string; // e.g. "500mg"
  frequency: string; // e.g. "twice daily"
  duration: string; // e.g. "5 days"
  /** Units to hand over (tablets, bottles…). Set by the doctor; the pharmacy
   *  can dispense less but never more. Absent on older prescriptions. */
  quantity?: number;
  dispensed: boolean;
}

/** A stocked product in the pharmacy catalog, searchable at the POS. */
export interface Medicine {
  id: ID;
  name: string;
  strength: string; // e.g. "500mg", "20/120"
  form: string; // tablet | capsule | syrup | inhaler | cream | sachet
  unitPrice: number; // selling price at the POS
  costPrice: number; // what the clinic pays the supplier
  stock: number;
  /** Prescription-only: the walk-in counter needs an outside prescription. */
  requiresPrescription: boolean;
  barcode?: string; // scanned at the counter
  genericName?: string; // active ingredient, so brands search together
  reorderLevel?: number; // restock trigger for this medicine
  /** Units in batches that have not expired — what may actually be sold.
   *  Undefined for medicines with no batches recorded yet (then `stock` rules). */
  sellable?: number;
  /** Units sitting in expired batches, blocked from sale. */
  expired?: number;
  /** Earliest expiry date still in stock, for the counter's warning badge. */
  nextExpiry?: string;
}

/** One clinic location with its own queue, stock and tills. */
export interface Branch {
  id: ID;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  isMain: boolean;
  active: boolean;
}

/** Stock sent from one branch to another. */
export interface StockTransfer {
  id: ID;
  medicineId: ID;
  fromBranchId: ID;
  toBranchId: ID;
  quantity: number;
  notes?: string;
  byName?: string;
  createdAt: string;
}

/** One delivery of a medicine: what's left of it, and when it expires. */
export interface MedicineBatch {
  id: ID;
  medicineId: ID;
  batchNumber?: string;
  expiryDate?: string;
  quantity: number;
  costPrice?: number;
  receivedAt: string;
  receivedBy?: string;
  notes?: string;
  branchId?: ID;
}

/** A cashier's till session at the pharmacy counter. */
export interface Shift {
  id: ID;
  cashierId: ID;
  cashierName: string;
  status: "open" | "closed" | "discrepancy";
  openedAt: string;
  closedAt?: string;
  openingCash: number;
  openingNotes?: string;
  closingCashCounted?: number;
  closingNotes?: string;
  totalCashSales: number;
  totalMpesaSales: number;
  totalCardSales: number;
  expectedClosingCash?: number;
  /** Counted cash minus expected: negative is a shortage, positive an overage. */
  cashShortageOverage?: number;
  mpesaVariance?: number;
}

/** One line of a pharmacy sale. Name/price are copied from the catalog at
 *  checkout so history stays correct if the catalog changes later. */
export interface SaleItem {
  medicineId: ID;
  name: string;
  quantity: number;
  unitPrice: number;
  unitCost?: number; // catalog costPrice at checkout; absent on older sales
}

export type ExpenseCategory =
  | "rent"
  | "salaries"
  | "utilities"
  | "supplies"
  | "equipment"
  | "other";

/** A running cost of the clinic, logged by an admin. Together with sale
 *  costs these make up the expense side of the profit & loss report. */
export interface Expense {
  id: ID;
  description: string;
  category: ExpenseCategory;
  amount: number;
  date: string; // the day the expense applies to
  recordedBy?: string;
  createdAt: string;
}

export type PaymentMethod = "cash" | "mpesa" | "card";

/** Legacy shape — a single lump payment recorded at the pharmacy POS. Kept for
 *  old records; new visits use `payments` + `charges` instead. */
export interface Payment {
  amount: number;
  method: PaymentMethod;
  reference?: string; // e.g. M-Pesa transaction code
  paidAt: string;
}

/** How a visit is billed end-to-end. */
export type BillingMode = "per-stage" | "pay-at-end";

/** What kind of billable line a Charge represents. Service charges carry the
 *  ordering department so a bill reads the way the patient experienced it. */
export type ChargeType =
  | "consultation"
  | "lab"
  | "radiology"
  | "procedure"
  | "pharmacy"
  | "misc";

/** One billable line on a visit. Added as the patient moves through:
 *  consultation fee at check-in, one per service ordered, one per medicine
 *  sold, misc for injections / dressings / bed fees. `paid` is toggled by a
 *  VisitPayment. */
export interface Charge {
  id: ID;
  type: ChargeType;
  description: string;
  amount: number;
  paid: boolean;
  paidAt?: string;
  paymentId?: ID; // id of the VisitPayment that settled this charge
  createdAt: string;
}

/** One payment event on a visit. per-stage visits have several; pay-at-end
 *  visits typically have one at pharmacy covering all outstanding charges. */
export interface VisitPayment {
  id: ID;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  paidAt: string;
  covers: ID[]; // Charge ids settled by this payment
  takenBy?: string; // staff username who took the payment
}

/**
 * An order is any actionable item the doctor creates on a visit. Service
 * orders (lab/radiology/procedure) carry a `result`; a prescription order
 * carries `meds`. Modelling all of them uniformly is what lets one visit fan
 * out to several departments at once and come back together.
 */
export interface Order {
  id: ID;
  visitId: ID;
  type: OrderType;
  title: string; // e.g. "Chest X-ray", "CBC", "Wound dressing"
  instructions?: string;
  status: OrderStatus;
  /** Which catalog service was ordered — supplies the price and, for labs, the
   *  parameter panel. Prescriptions leave this unset. */
  serviceItemId?: ID;
  /** Structured results — one entry per parameter. Lab orders use this; radiology
   *  and procedure still use the free-text `result` below. */
  results?: LabResult[];
  result?: string; // filled by radiology/procedure (free-text)
  meds?: Med[]; // only for type === "prescription"
  createdAt: string;
  completedAt?: string;
}

/** One parameter of a lab test's result panel, with the reference range the
 *  lab flags against. */
export interface LabParameter {
  name: string; // e.g. "WBC"
  unit: string; // e.g. "10^9/L"
  refLow?: number;
  refHigh?: number;
}

/** One measured value entered by the lab. Stored as string so qualitative
 *  results ("positive"/"negative") work alongside numeric ones. */
export interface LabResult {
  parameter: string;
  value: string;
  flag?: "low" | "high" | "normal";
}

/** A billable service the clinic offers — lab tests, imaging and procedures.
 *  Doctors order from this catalog; the picked item supplies the price (which
 *  becomes a Charge) and, for labs, the technician's parameter entry form. */
export interface ServiceItem {
  id: ID;
  name: string;
  orderType: Exclude<OrderType, "prescription">; // which station runs it
  category: string; // haematology | biochemistry | microbiology | serology | urinalysis | imaging | other
  price: number;
  parameters: LabParameter[]; // empty for radiology / procedure
  active: boolean;
  createdAt: string;
}

/** Singleton clinic-wide settings. */
export interface ClinicSettings {
  id: ID;
  billingMode: BillingMode;
  consultationFee: number;
  updatedAt: string;
  updatedById?: ID;
}

/** A daily physical cash count entered by an admin, reconciled against the
 *  cash recorded on that day's visit payments. */
export interface CashCount {
  id: ID;
  date: string; // "YYYY-MM-DD" — the counted day
  counted: number;
  notes?: string;
  countedBy?: string;
  createdAt: string;
}

/** One Daraja STK push, as exposed to the reconciliation page. */
export interface MpesaTxn {
  id: ID;
  phone: string;
  amount: number;
  status: "pending" | "success" | "failed";
  receipt?: string;
  visitId?: ID;
  createdAt: string;
}

export interface ClinicData {
  doctors: Doctor[];
  patients: Patient[];
  visits: Visit[];
  orders: Order[];
  medicines: Medicine[];
  serviceCatalog: ServiceItem[]; // priced lab / radiology / procedure catalog
  settings: ClinicSettings; // clinic-wide billing mode + consultation fee
  batches: MedicineBatch[]; // stock deliveries with expiry dates
  branches: Branch[]; // every clinic location (active and closed)
  /** Which branch the screens are showing; null = all branches (admins). */
  viewBranchId: ID | null;
  /** Can this user switch branches (admins), or are they fixed to theirs? */
  canSwitchBranch: boolean;
  transfers?: StockTransfer[]; // recent stock transfers (stock managers)
  /** The signed-in cashier's open till session, if they have one. */
  myShift?: Shift | null;
  /** Till sessions closed recently — the manager's reconciliation list. */
  shifts?: Shift[];
  expenses: Expense[]; // admin-only; empty for other roles
  cashCounts: CashCount[]; // admin-only; empty for other roles
  mpesaTransactions: MpesaTxn[]; // admin-only; empty for other roles
  /** Server cursor: pass back as `since` to get only what changed after it. */
  syncedAt?: string;
  /** Set on an incremental response: patients, visits, orders and M-Pesa
   *  transactions hold only changed records, to be merged into the full set. */
  partial?: true;
}
