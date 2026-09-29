// Demo data generator — fills the clinic with a few months of believable
// history so the dashboard, reports and reconciliation pages have something to
// show.
//
//   pnpm db:demo                  90 days of history + today's live queue
//   pnpm db:demo -- --days=30     a shorter window
//   pnpm db:demo -- --per-day=14  busier clinic
//   pnpm db:demo -- --reset       remove every demo record, leave real data
//   pnpm db:demo -- --reset --days=60   reset, then regenerate
//
// Everything it writes is tagged so it can be removed again exactly:
// patients carry an MRN of "D-####" and a national ID of "DEMO-####" (their
// visits and orders hang off those), expenses and cash counts are stamped
// "Demo data", and M-Pesa transactions use a "ws_CO_DEMO_" request id. The
// reset deletes precisely those and nothing else, so a real patient recorded
// by hand is never touched.
//
// The generator only ever writes patients, visits, orders, expenses, cash
// counts and M-Pesa rows. It does not touch clinic settings, the medicine
// catalog, the service catalog or staff — run `pnpm db:seed` first if those
// are empty.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// --- tags that make every demo row identifiable ------------------------------

const MRN_PREFIX = "D-";
const NATIONAL_ID_PREFIX = "DEMO-";
const DEMO_STAMP = "Demo data";
const MPESA_PREFIX = "ws_CO_DEMO_";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

// --- deterministic randomness ------------------------------------------------
// A fixed seed means two runs of the same command produce the same clinic —
// screenshots and demos stay reproducible.

let seed = 0x9e3779b9;
function rnd(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)];
const chance = (p: number) => rnd() < p;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** One index sampled from a weighted list — used for arrival hours. */
function weightedIndex(weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// --- name pools --------------------------------------------------------------

const FIRST_F = [
  "Amina", "Wanjiru", "Achieng", "Fatuma", "Grace", "Mercy", "Njeri", "Halima",
  "Esther", "Naliaka", "Chebet", "Zawadi", "Aisha", "Mumbi", "Nyambura",
  "Wangeci", "Sifa", "Rehema", "Cynthia", "Purity",
];
const FIRST_M = [
  "John", "Kamau", "Otieno", "Musa", "Brian", "Daniel", "Kiprop", "Omar",
  "Peter", "Wafula", "Kelvin", "Mutiso", "Abdi", "Njoroge", "Simiyu",
  "Dennis", "Baraka", "Erick", "Mwangi", "Juma",
];
const LAST = [
  "Mwangi", "Otieno", "Wanjiku", "Kiprotich", "Hassan", "Mutua", "Ochieng",
  "Njoroge", "Kimani", "Barasa", "Chepkoech", "Abdullahi", "Mbugua", "Owuor",
  "Wekesa", "Muthoni", "Kariuki", "Onyango", "Cheruiyot", "Yusuf",
];

const COMPLAINTS = [
  "Fever and headache for three days",
  "Persistent cough with chest tightness",
  "Lower abdominal pain, worse after meals",
  "Generalised body weakness and joint pain",
  "Diarrhoea and vomiting since yesterday",
  "Sore throat with difficulty swallowing",
  "Recurrent headache and dizziness",
  "Skin rash on both forearms, itchy",
  "Burning sensation on passing urine",
  "Follow-up review after malaria treatment",
  "Back pain after lifting at work",
  "Ear pain and reduced hearing on the left",
  "Wound on the right shin, needs dressing",
  "High blood pressure review and refill",
  "Child with fever and poor feeding",
];

const RADIOLOGY_FINDINGS = [
  "No acute cardiopulmonary abnormality. Heart size normal.",
  "Mild peribronchial thickening; no consolidation seen.",
  "No fracture or dislocation. Soft tissues unremarkable.",
  "Normal study. No focal lesion identified.",
  "Small right-sided pleural effusion noted; clinical correlation advised.",
];
const PROCEDURE_NOTES = [
  "Procedure completed without complication. Patient tolerated well.",
  "Wound cleaned and dressed. Review in 3 days.",
  "Injection administered. Observed 20 minutes, no reaction.",
  "Sutures applied (4). Advised to keep dry and return for removal.",
];

// --- arrival shape -----------------------------------------------------------

/** Clinic hours 8am–5pm, busiest mid-morning and again after lunch. */
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const HOUR_WEIGHTS = [6, 14, 16, 13, 8, 5, 11, 12, 8, 4];
/** Sunday-first, matching Date#getDay. Weekends are quiet, Monday is not. */
const WEEKDAY_FACTOR = [0.25, 1.15, 1.0, 1.0, 0.95, 1.05, 0.55];

// --- helpers -----------------------------------------------------------------

type Vitals = { weight: string; temperature: string; bloodPressure: string };

function vitals(age: number): Vitals {
  const weight = age < 13 ? int(9, 38) : int(48, 96);
  const temp = chance(0.28) ? 37.5 + rnd() * 2 : 36.2 + rnd() * 1.1;
  const systolic = int(104, 148);
  return {
    weight: String(weight),
    temperature: temp.toFixed(1),
    bloodPressure: `${systolic}/${int(64, 94)}`,
  };
}

function phone(): string {
  return `07${int(10, 39)} ${String(int(100000, 999999))}`;
}

/** A lab value for one parameter — mostly normal, sometimes flagged. */
function labValue(param: { name: string; unit: string; refLow?: number | null; refHigh?: number | null }) {
  const { refLow, refHigh } = param;
  if (refLow == null || refHigh == null) {
    const name = param.name.toLowerCase();
    if (name.includes("result") || name.includes("parasites") || name.includes("seen")) {
      return { parameter: param.name, value: chance(0.22) ? "Positive" : "Negative", flag: null };
    }
    if (name.includes("colour")) {
      return { parameter: param.name, value: pick(["Straw", "Pale yellow", "Amber"]), flag: null };
    }
    if (name.includes("density")) {
      return { parameter: param.name, value: String(int(120, 4800)), flag: null };
    }
    return {
      parameter: param.name,
      value: pick(["Nil", "Trace", "+", "Negative"]),
      flag: null,
    };
  }
  const span = refHigh - refLow;
  const roll = rnd();
  // ~18% of results land outside the reference range, split low and high.
  const raw =
    roll < 0.09
      ? refLow - span * (0.05 + rnd() * 0.3)
      : roll < 0.18
        ? refHigh + span * (0.05 + rnd() * 0.35)
        : refLow + span * (0.12 + rnd() * 0.76);
  const value = span < 5 ? raw.toFixed(1) : String(Math.round(raw));
  const num = Number(value);
  return {
    parameter: param.name,
    value,
    flag: num < refLow ? "low" : num > refHigh ? "high" : "normal",
  };
}

const DOSAGES = ["1 tablet", "2 tablets", "5ml", "10ml", "1 capsule", "1 sachet"];
const FREQUENCIES = ["once daily", "twice daily", "three times a day", "every 8 hours", "at night"];
const DURATIONS = ["3 days", "5 days", "7 days", "10 days", "14 days"];

/** MongoDB rejects an empty insert, and an empty batch is normal here (a short
 *  window may produce no cash counts at all). */
async function insertMany<T>(
  label: string,
  rows: T[],
  write: (rows: T[]) => Promise<unknown>,
) {
  if (rows.length === 0) {
    console.log(`No ${label} to write.`);
    return;
  }
  console.log(`Writing ${rows.length} ${label}…`);
  await write(rows);
}

// --- reset -------------------------------------------------------------------

async function resetDemo() {
  const patients = await prisma.patient.findMany({
    where: { nationalId: { startsWith: NATIONAL_ID_PREFIX } },
    select: { id: true },
  });
  const patientIds = patients.map((p) => p.id);

  const visits = await prisma.visit.findMany({
    where: { patientId: { in: patientIds } },
    select: { id: true },
  });
  const visitIds = visits.map((v) => v.id);

  const orders = await prisma.order.deleteMany({ where: { visitId: { in: visitIds } } });
  const visitsDeleted = await prisma.visit.deleteMany({ where: { id: { in: visitIds } } });
  const patientsDeleted = await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
  const expenses = await prisma.expense.deleteMany({ where: { recordedBy: DEMO_STAMP } });
  const cash = await prisma.cashCount.deleteMany({ where: { notes: DEMO_STAMP } });
  const mpesa = await prisma.mpesaTransaction.deleteMany({
    where: { checkoutRequestId: { startsWith: MPESA_PREFIX } },
  });

  console.log(
    `Removed demo data: ${patientsDeleted.count} patients, ${visitsDeleted.count} visits, ` +
      `${orders.count} orders, ${expenses.count} expenses, ${cash.count} cash counts, ` +
      `${mpesa.count} M-Pesa transactions.`,
  );
}

// --- generation --------------------------------------------------------------

type ChargeRow = {
  id: string;
  type: string;
  description: string;
  amount: number;
  paid: boolean;
  paidAt: Date | null;
  paymentId: string | null;
  createdAt: Date;
};

type BuiltVisit = {
  patientKey: string;
  createdAt: Date;
  data: Record<string, unknown>;
  orders: {
    type: string;
    title: string;
    instructions?: string;
    status: string;
    serviceItemId?: string;
    results?: { parameter: string; value: string; flag: string | null }[];
    result?: string;
    meds?: Record<string, unknown>[];
    createdAt: Date;
    completedAt?: Date;
  }[];
};

async function generate(days: number, perDay: number) {
  const doctors = await prisma.user.findMany({
    where: { role: "doctor", active: true },
    select: { id: true, name: true },
  });
  const medicines = await prisma.medicine.findMany();
  const services = await prisma.serviceItem.findMany({ where: { active: true } });

  if (doctors.length === 0 || medicines.length === 0 || services.length === 0) {
    throw new Error(
      "Demo data needs staff, medicines and a service catalog first — run `pnpm db:seed`.",
    );
  }

  const labs = services.filter((s) => s.orderType === "lab");
  const imaging = services.filter((s) => s.orderType === "radiology");
  const procedures = services.filter((s) => s.orderType === "procedure");

  // Continue the demo MRN sequence rather than colliding with an earlier run.
  const lastDemo = await prisma.patient.findFirst({
    where: { mrn: { startsWith: MRN_PREFIX } },
    orderBy: { mrn: "desc" },
    select: { mrn: true },
  });
  let mrnCounter = lastDemo ? Number(lastDemo.mrn.slice(MRN_PREFIX.length)) || 0 : 0;

  const CONSULT_FEE = 500;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  type NewPatient = {
    key: string;
    mrn: string;
    nationalId: string;
    firstName: string;
    lastName: string;
    gender: string;
    age: number;
    phone: string;
    createdAt: Date;
  };

  const newPatients: NewPatient[] = [];
  const builtVisits: BuiltVisit[] = [];
  const mpesaRows: Record<string, unknown>[] = [];
  /** Cash taken per calendar day, for the cash counts below. */
  const cashByDay = new Map<number, number>();

  function makePatient(registeredAt: Date): NewPatient {
    mrnCounter += 1;
    const female = chance(0.54);
    const patient: NewPatient = {
      key: `${MRN_PREFIX}${String(mrnCounter).padStart(4, "0")}`,
      mrn: `${MRN_PREFIX}${String(mrnCounter).padStart(4, "0")}`,
      nationalId: `${NATIONAL_ID_PREFIX}${String(mrnCounter).padStart(4, "0")}`,
      firstName: female ? pick(FIRST_F) : pick(FIRST_M),
      lastName: pick(LAST),
      gender: female ? "female" : "male",
      age: chance(0.18) ? int(1, 12) : int(16, 78),
      phone: phone(),
      createdAt: registeredAt,
    };
    newPatients.push(patient);
    return patient;
  }

  /** Build one visit end to end: timeline, orders, charges, payment, sale. */
  function buildVisit(arrival: Date, opts: { live?: string } = {}) {
    // Returning patients keep the register realistic — not everyone is new.
    const returning = newPatients.length > 25 && chance(0.38);
    const patient = returning
      ? newPatients[int(0, newPatients.length - 1)]
      : makePatient(arrival);

    const doctor = pick(doctors);
    const age = patient.age;
    const priority = chance(0.06) ? "emergency" : chance(0.2) ? "urgent" : "normal";

    const timeline: { status: string; at: Date }[] = [];
    const charges: ChargeRow[] = [];
    const orders: BuiltVisit["orders"] = [];
    let cursor = arrival.getTime();
    const step = (min: number, max: number) => {
      cursor += int(min, max) * MINUTE;
      return new Date(cursor);
    };
    const addCharge = (type: string, description: string, amount: number, at: Date) => {
      const charge: ChargeRow = {
        id: crypto.randomUUID(),
        type,
        description,
        amount: round2(amount),
        paid: false,
        paidAt: null,
        paymentId: null,
        createdAt: at,
      };
      charges.push(charge);
      return charge;
    };

    timeline.push({ status: "awaiting-triage", at: new Date(cursor) });
    addCharge("consultation", "Consultation fee", CONSULT_FEE, new Date(cursor));
    const stopAt = opts.live;
    if (stopAt === "awaiting-triage") {
      return finish("awaiting-triage");
    }

    timeline.push({ status: "waiting", at: step(4, 22) });
    if (stopAt === "waiting") return finish("waiting");

    timeline.push({ status: "with-doctor", at: step(6, 55) });
    if (stopAt === "with-doctor") return finish("with-doctor");

    const wantsLab = labs.length > 0 && chance(0.46);
    const wantsImaging = imaging.length > 0 && chance(0.13);
    const wantsProcedure = procedures.length > 0 && chance(0.09);
    const hasServices = wantsLab || wantsImaging || wantsProcedure;

    const orderedAt = new Date(cursor);
    const serviceOrders: { item: (typeof services)[number]; type: string }[] = [];
    if (wantsLab) {
      serviceOrders.push({ item: pick(labs), type: "lab" });
      if (chance(0.22)) serviceOrders.push({ item: pick(labs), type: "lab" });
    }
    if (wantsImaging) serviceOrders.push({ item: pick(imaging), type: "radiology" });
    if (wantsProcedure) serviceOrders.push({ item: pick(procedures), type: "procedure" });

    for (const { item, type } of serviceOrders) {
      addCharge(type, item.name, item.price, orderedAt);
    }

    if (hasServices) {
      timeline.push({ status: "awaiting-services", at: step(2, 12) });
      if (stopAt === "awaiting-services") {
        for (const { item, type } of serviceOrders) {
          orders.push({
            type,
            title: item.name,
            status: chance(0.4) ? "in-progress" : "requested",
            serviceItemId: item.id,
            createdAt: orderedAt,
          });
        }
        return finish("awaiting-services");
      }
      const resultAt = step(15, 75);
      for (const { item, type } of serviceOrders) {
        orders.push({
          type,
          title: item.name,
          status: "completed",
          serviceItemId: item.id,
          results:
            type === "lab" ? item.parameters.map((p) => labValue(p)) : undefined,
          result:
            type === "radiology"
              ? pick(RADIOLOGY_FINDINGS)
              : type === "procedure"
                ? pick(PROCEDURE_NOTES)
                : undefined,
          createdAt: orderedAt,
          completedAt: resultAt,
        });
      }
      timeline.push({ status: "back-to-doctor", at: resultAt });
      if (stopAt === "back-to-doctor") return finish("back-to-doctor");
      step(4, 20);
    }

    const prescribed = chance(0.82)
      ? Array.from({ length: int(1, 3) }, () => pick(medicines))
      : [];
    if (prescribed.length > 0) {
      orders.push({
        type: "prescription",
        title: "Prescription",
        status: stopAt === "awaiting-pharmacy" ? "requested" : "completed",
        meds: prescribed.map((m) => ({
          id: crypto.randomUUID(),
          medicineId: m.id,
          name: `${m.name} ${m.strength}`.trim(),
          dosage: pick(DOSAGES),
          frequency: pick(FREQUENCIES),
          duration: pick(DURATIONS),
          dispensed: stopAt !== "awaiting-pharmacy",
        })),
        createdAt: new Date(cursor),
        completedAt: stopAt === "awaiting-pharmacy" ? undefined : new Date(cursor),
      });
    }

    timeline.push({ status: "awaiting-pharmacy", at: step(3, 18) });
    if (stopAt === "awaiting-pharmacy") return finish("awaiting-pharmacy");

    // Checkout: what was actually dispensed, then one payment for the lot.
    const saleItems = prescribed.map((m) => {
      const quantity = m.form === "tablet" || m.form === "capsule" ? int(6, 30) : int(1, 2);
      return {
        medicineId: m.id,
        name: `${m.name} ${m.strength}`.trim(),
        quantity,
        unitPrice: m.unitPrice,
        unitCost: m.costPrice,
      };
    });
    const closedAt = step(4, 26);
    for (const item of saleItems) {
      addCharge(
        "pharmacy",
        item.quantity > 1 ? `${item.name} × ${item.quantity}` : item.name,
        item.quantity * item.unitPrice,
        closedAt,
      );
    }
    if (chance(0.08)) {
      addCharge("misc", pick(["Injection fee", "Dressing", "Observation bed"]), int(2, 12) * 50, closedAt);
    }

    // A few visits close with the bill only partly settled — the debtors list.
    const partial = chance(0.07);
    const settling = partial
      ? charges.filter((c) => c.type !== "pharmacy")
      : [...charges];
    const method = rnd() < 0.52 ? "mpesa" : rnd() < 0.86 ? "cash" : "card";
    const paymentId = crypto.randomUUID();
    const amount = round2(settling.reduce((s, c) => s + c.amount, 0));
    const reference =
      method === "mpesa"
        ? `S${int(10, 99)}${String.fromCharCode(65 + int(0, 25))}${int(100000, 999999)}`
        : undefined;

    for (const c of settling) {
      c.paid = true;
      c.paidAt = closedAt;
      c.paymentId = paymentId;
    }

    if (method === "cash") {
      const day = new Date(closedAt);
      day.setHours(0, 0, 0, 0);
      cashByDay.set(day.getTime(), (cashByDay.get(day.getTime()) ?? 0) + amount);
    }
    if (method === "mpesa" && chance(0.7)) {
      mpesaRows.push({
        checkoutRequestId: `${MPESA_PREFIX}${crypto.randomUUID().slice(0, 12)}`,
        phone: patient.phone.replace(/\s/g, "").replace(/^0/, "254"),
        amount,
        status: "success",
        receipt: reference,
        createdAt: closedAt,
        updatedAt: closedAt,
      });
    }

    timeline.push({ status: "completed", at: closedAt });
    return finish("completed", {
      saleItems,
      payments: [
        {
          id: paymentId,
          amount,
          method,
          reference,
          paidAt: closedAt,
          covers: settling.map((c) => c.id),
          takenBy: "pharmacy",
        },
      ],
    });

    function finish(status: string, extra: Record<string, unknown> = {}) {
      builtVisit({
        patientKey: patient.key,
        createdAt: arrival,
        data: {
          vitals:
            status === "awaiting-triage"
              ? { weight: "", temperature: "", bloodPressure: "" }
              : vitals(age),
          priority: status === "awaiting-triage" ? null : priority,
          complaint: status === "awaiting-triage" || status === "waiting" ? "" : pick(COMPLAINTS),
          assignedDoctorId: doctor.id,
          status,
          timeline,
          billingMode: "pay-at-end",
          charges,
          createdAt: arrival,
          updatedAt: timeline[timeline.length - 1].at,
          ...extra,
        },
        orders,
      });
    }
  }

  function builtVisit(v: BuiltVisit) {
    builtVisits.push(v);
  }

  // --- history -------------------------------------------------------------
  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(startOfToday.getTime() - d * DAY_MS);
    const factor = WEEKDAY_FACTOR[date.getDay()];
    // A gentle upward trend over the window, so the charts show a direction.
    const growth = 0.78 + ((days - d) / days) * 0.44;
    const count = Math.max(0, Math.round(perDay * factor * growth * (0.75 + rnd() * 0.5)));

    for (let i = 0; i < count; i++) {
      const hour = HOURS[weightedIndex(HOUR_WEIGHTS)];
      const arrival = new Date(date);
      arrival.setHours(hour, int(0, 59), int(0, 59), 0);
      // Today only counts visits that have already happened.
      if (d === 0 && arrival.getTime() > Date.now()) continue;
      buildVisit(arrival);
    }
  }

  // --- today's live queue ---------------------------------------------------
  // Patients still in the building, spread across every station, so the
  // dashboard's "Right now" board and each station page have work waiting.
  const LIVE: { status: string; count: number }[] = [
    { status: "awaiting-triage", count: 2 },
    { status: "waiting", count: 3 },
    { status: "with-doctor", count: 2 },
    { status: "awaiting-services", count: 3 },
    { status: "back-to-doctor", count: 1 },
    { status: "awaiting-pharmacy", count: 2 },
  ];
  for (const { status, count } of LIVE) {
    for (let i = 0; i < count; i++) {
      const minutesAgo = int(15, 220);
      buildVisit(new Date(Date.now() - minutesAgo * MINUTE), { live: status });
    }
  }

  // --- write patients, then visits, then orders -----------------------------
  await insertMany("patients", newPatients, (rows) =>
    prisma.patient.createMany({ data: rows.map(({ key: _key, ...p }) => p) }),
  );
  const savedPatients = await prisma.patient.findMany({
    where: { nationalId: { startsWith: NATIONAL_ID_PREFIX } },
    select: { id: true, mrn: true },
  });
  const patientIdByMrn = new Map(savedPatients.map((p) => [p.mrn, p.id]));

  await insertMany("visits", builtVisits, (rows) =>
    prisma.visit.createMany({
      data: rows.map((v) => ({
        ...v.data,
        patientId: patientIdByMrn.get(v.patientKey)!,
      })) as never,
    }),
  );

  // Match the saved visits back to what was built, so their orders can point
  // at real ids. (patientId, createdAt) is unique here by construction.
  const savedVisits = await prisma.visit.findMany({
    where: { patientId: { in: [...patientIdByMrn.values()] } },
    select: { id: true, patientId: true, createdAt: true },
  });
  const visitIdByKey = new Map(
    savedVisits.map((v) => [`${v.patientId}|${v.createdAt.getTime()}`, v.id]),
  );

  const orderRows = builtVisits.flatMap((v) => {
    const patientId = patientIdByMrn.get(v.patientKey)!;
    const visitId = visitIdByKey.get(`${patientId}|${v.createdAt.getTime()}`);
    if (!visitId) return [];
    return v.orders.map((o) => ({ ...o, visitId }));
  });
  await insertMany("orders", orderRows, (rows) =>
    prisma.order.createMany({ data: rows as never }),
  );

  // --- expenses -------------------------------------------------------------
  const expenses: Record<string, unknown>[] = [];
  const firstDay = new Date(startOfToday.getTime() - (days - 1) * DAY_MS);
  for (let t = firstDay.getTime(); t <= startOfToday.getTime(); t += DAY_MS) {
    const date = new Date(t);
    const dom = date.getDate();
    const add = (description: string, category: string, amount: number) =>
      expenses.push({
        description,
        category,
        amount,
        date,
        recordedBy: DEMO_STAMP,
        createdAt: date,
      });
    if (dom === 1) add("Monthly clinic rent", "rent", 65000);
    if (dom === 28) add("Staff salaries", "salaries", 285000);
    if (dom === 5) add("Electricity and water", "utilities", int(9, 16) * 1000);
    if (dom === 6) add("Internet and airtime", "utilities", 6500);
    if (date.getDay() === 2) add("Consumables and cleaning supplies", "supplies", int(3, 9) * 1000);
    if (dom === 15 && chance(0.6)) add(pick(["BP machine servicing", "Microscope lamp", "Autoclave repair"]), "equipment", int(6, 24) * 1000);
    if (chance(0.05)) add(pick(["Waste disposal", "County licence fee", "Staff transport"]), "other", int(2, 12) * 1000);
  }
  await insertMany("expenses", expenses, (rows) =>
    prisma.expense.createMany({ data: rows as never }),
  );

  // --- cash counts ----------------------------------------------------------
  // Yesterday and back: what the drawer actually held, usually matching the
  // recorded cash and occasionally a little off — that is what the
  // reconciliation page is for.
  const existingCounts = await prisma.cashCount.findMany({ select: { date: true } });
  const takenDates = new Set(existingCounts.map((c) => c.date.getTime()));
  const cashRows: Record<string, unknown>[] = [];
  for (const [dayMs, total] of [...cashByDay.entries()].sort((a, b) => a[0] - b[0])) {
    if (dayMs >= startOfToday.getTime()) continue; // today isn't counted yet
    const date = new Date(Date.UTC(
      new Date(dayMs).getFullYear(),
      new Date(dayMs).getMonth(),
      new Date(dayMs).getDate(),
    ));
    if (takenDates.has(date.getTime())) continue;
    const off = chance(0.22) ? int(-6, 6) * 50 : 0;
    cashRows.push({
      date,
      counted: Math.max(0, round2(total + off)),
      notes: DEMO_STAMP, // the tag --reset keys off
      countedBy: "Demo cashier",
      createdAt: new Date(dayMs + 18 * 60 * MINUTE),
      updatedAt: new Date(dayMs + 18 * 60 * MINUTE),
    });
  }
  await insertMany("cash counts", cashRows, (rows) =>
    prisma.cashCount.createMany({ data: rows as never }),
  );

  // --- M-Pesa ---------------------------------------------------------------
  // A couple of unmatched pushes, because real days have them.
  for (let i = 0; i < 4; i++) {
    const at = new Date(Date.now() - int(0, days) * DAY_MS);
    mpesaRows.push({
      checkoutRequestId: `${MPESA_PREFIX}${crypto.randomUUID().slice(0, 12)}`,
      phone: `2547${int(10000000, 99999999)}`,
      amount: int(4, 40) * 50,
      status: chance(0.5) ? "pending" : "failed",
      resultDesc: chance(0.5) ? "Request cancelled by user" : "DS timeout",
      createdAt: at,
      updatedAt: at,
    });
  }
  await insertMany("M-Pesa transactions", mpesaRows, (rows) =>
    prisma.mpesaTransaction.createMany({ data: rows as never }),
  );

  // --- summary --------------------------------------------------------------
  const revenue = builtVisits.reduce(
    (sum, v) =>
      sum +
      ((v.data.payments as { amount: number }[] | undefined) ?? []).reduce(
        (s, p) => s + p.amount,
        0,
      ),
    0,
  );
  const live = builtVisits.filter((v) => v.data.status !== "completed").length;
  console.log(
    `\nDone. ${days} days of history: ${builtVisits.length} visits ` +
      `(${live} still open), ${newPatients.length} new patients, ` +
      `KSh ${Math.round(revenue).toLocaleString("en-KE")} collected.`,
  );
}

// --- entry point -------------------------------------------------------------

function numberArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split("=")[1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main() {
  const reset = process.argv.includes("--reset");
  if (reset) await resetDemo();
  // `--reset` on its own clears and stops; pass it with other flags to rebuild.
  if (reset && process.argv.length === 3) return;
  await generate(numberArg("days", 90), numberArg("per-day", 10));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
