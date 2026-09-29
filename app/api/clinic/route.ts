// REST boundary between the browser and MongoDB.
//   GET  /api/clinic        → the whole dataset (doctors, patients, visits, orders)
//   GET  /api/clinic?since= → only records changed after the cursor (`partial`)
//   POST /api/clinic        → { action, payload, since? }, performs the mutation and
//                             returns the fresh dataset (or the changes since `since`).

import { NextResponse } from "next/server";
import * as repo from "@/lib/server/clinic-repo";
import { getSession } from "@/lib/auth/session";
import {
  canView,
  hasPermission,
  type Permission,
  type SessionUser,
} from "@/lib/auth/roles";
import { type BranchContext, branchContext } from "@/lib/server/branches";
import { lockMessageFor, systemLock } from "@/lib/server/developer";

// Prisma needs the Node.js runtime, and reads must never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A valid `since` cursor, or undefined for a full load. */
function parseSince(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** While the developer has locked the system, clinic accounts can't read or
 *  write. (The developer account itself is never locked out.) */
async function lockedOut(session: SessionUser) {
  if (session.role === "developer") return null;
  const lock = await systemLock();
  return lock.locked
    ? NextResponse.json({ error: lockMessageFor(lock), locked: true }, { status: 423 })
    : null;
}

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const locked = await lockedOut(session);
    if (locked) return locked;
    const data = await repo.getClinicData({
      // The developer reads everything, finance included.
      includeFinance: canView(session.role, "clinic.finance.manage"),
      since: parseSince(new URL(req.url).searchParams.get("since")),
      userId: session.id,
      branch: await branchContext(session),
    });
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/clinic failed", err);
    return NextResponse.json({ error: "Failed to load data" }, { status: 500 });
  }
}

// Which permission is required for each mutation. This keeps route policies
// centralized and decoupled from literal role names.
const ACTION_PERMISSIONS: Record<string, Permission> = {
  registerPatient: "clinic.reception.manage",
  startVisit: "clinic.reception.manage",
  recordTriage: "clinic.reception.manage",
  assignVisitDoctor: "clinic.doctor.manage",
  startConsult: "clinic.doctor.manage",
  setVisitComplaint: "clinic.doctor.manage",
  addServiceOrder: "clinic.doctor.manage",
  addServiceOrders: "clinic.doctor.manage",
  addPrescription: "clinic.doctor.manage",
  startServiceOrder: "clinic.services.manage",
  completeServiceOrder: "clinic.services.manage",
  sendToPharmacy: "clinic.doctor.manage",
  toggleMedDispensed: "clinic.pharmacy.manage",
  dispenseAndClose: "clinic.pharmacy.manage",
  checkoutVisit: "clinic.pharmacy.manage",
  sellWalkIn: "clinic.pharmacy.manage",
  openShift: "clinic.payments.take",
  closeShift: "clinic.payments.take",
  receiveStock: "clinic.medicine.manage",
  writeOffBatch: "clinic.medicine.manage",
  transferStock: "clinic.medicine.manage",
  payCharges: "clinic.payments.take",
  addMedicine: "clinic.medicine.manage",
  updateMedicine: "clinic.medicine.manage",
  importMedicines: "clinic.medicine.manage",
  clearMedicines: "clinic.mutate.all",
  addServiceItem: "clinic.catalog.manage",
  updateServiceItem: "clinic.catalog.manage",
  addExpense: "clinic.finance.manage",
  deleteExpense: "clinic.finance.manage",
  recordCashCount: "clinic.finance.manage",
  updateSettings: "clinic.mutate.all",
};

// Map each action name to its repository handler.
const handlers: Record<string, (payload: unknown) => Promise<unknown>> = {
  registerPatient: (p) => repo.registerPatient(p as never),
  startVisit: (p) => repo.startVisit(p as never),
  recordTriage: (p) => repo.recordTriage(p as never),
  assignVisitDoctor: (p) => repo.assignVisitDoctor(p as never),
  startConsult: (p) => repo.startConsult(p as never),
  setVisitComplaint: (p) => repo.setVisitComplaint(p as never),
  addServiceOrder: (p) => repo.addServiceOrder(p as never),
  addServiceOrders: (p) => repo.addServiceOrders(p as never),
  addPrescription: (p) => repo.addPrescription(p as never),
  startServiceOrder: (p) => repo.startServiceOrder(p as never),
  completeServiceOrder: (p) => repo.completeServiceOrder(p as never),
  sendToPharmacy: (p) => repo.sendToPharmacy(p as never),
  toggleMedDispensed: (p) => repo.toggleMedDispensed(p as never),
  dispenseAndClose: (p) => repo.dispenseAndClose(p as never),
  checkoutVisit: (p) => repo.checkoutVisit(p as never),
  sellWalkIn: (p) => repo.sellWalkIn(p as never),
  openShift: (p) => repo.openShift(p as never),
  closeShift: (p) => repo.closeShift(p as never),
  receiveStock: (p) => repo.receiveStock(p as never),
  writeOffBatch: (p) => repo.writeOffBatch(p as never),
  transferStock: (p) => repo.transferStock(p as never),
  payCharges: (p) => repo.payCharges(p as never),
  addMedicine: (p) => repo.addMedicine(p as never),
  updateMedicine: (p) => repo.updateMedicine(p as never),
  importMedicines: (p) => repo.importMedicines(p as never),
  clearMedicines: (p) => repo.clearMedicines(p as never),
  addServiceItem: (p) => repo.addServiceItem(p as never),
  updateServiceItem: (p) => repo.updateServiceItem(p as never),
  addExpense: (p) => repo.addExpense(p as never),
  deleteExpense: (p) => repo.deleteExpense(p as never),
  recordCashCount: (p) => repo.recordCashCount(p as never),
  updateSettings: (p) => repo.updateSettings(p as never),
};

// Fields the server fills in from the logged-in session rather than trusting
// the client — so nobody can claim someone else registered the patient, filed
// the expense, or took the money — and the branch the work belongs to, so
// staff can only ever write into their own branch.
const SESSION_STAMPS: Record<string, (s: SessionUser, b: BranchContext) => object> = {
  registerPatient: (s, b) => ({ registeredById: s.id, branchId: b.writeBranchId }),
  startVisit: (_s, b) => ({ branchId: b.writeBranchId }),
  addExpense: (s) => ({ recordedById: s.id, recordedBy: s.name }),
  recordCashCount: (s) => ({ countedById: s.id, countedBy: s.name }),
  updateSettings: (s) => ({ updatedById: s.id }),
  payCharges: (s) => ({ takenBy: s.name }),
  checkoutVisit: (s) => ({ takenBy: s.name, takenByUserId: s.id }),
  sellWalkIn: (s, b) => ({ takenBy: s.name, takenByUserId: s.id, branchId: b.writeBranchId }),
  openShift: (s, b) => ({ cashierId: s.id, cashierName: s.name, branchId: b.writeBranchId }),
  closeShift: (s) => ({ cashierId: s.id }),
  // Every inventory change carries who made it — the audit trail's "by".
  receiveStock: (s, b) => ({ receivedBy: s.name, receivedById: s.id, branchId: b.writeBranchId }),
  writeOffBatch: (s) => ({ writtenOffBy: s.name, writtenOffById: s.id }),
  addMedicine: (s, b) => ({ branchId: b.writeBranchId, changedBy: s.name, changedById: s.id }),
  updateMedicine: (s, b) => ({ branchId: b.writeBranchId, changedBy: s.name, changedById: s.id }),
  importMedicines: (s, b) => ({ branchId: b.writeBranchId, changedBy: s.name, changedById: s.id }),
  clearMedicines: (s) => ({ changedBy: s.name, changedById: s.id }),
  // Branch staff can only send stock out of their own branch; admins choose.
  transferStock: (s, b) => ({
    byName: s.name,
    byId: s.id,
    ...(!b.canSwitch && { fromBranchId: b.writeBranchId }),
  }),
};

/** Actions that act on one branch's shelf, drawer or queue. */
function needsBranch(action: string, payload: unknown): boolean {
  const p = (payload ?? {}) as { stock?: unknown };
  switch (action) {
    case "registerPatient":
    case "startVisit":
    case "sellWalkIn":
    case "openShift":
    case "receiveStock":
    case "importMedicines":
      return true;
    // Editing a name or price is catalog-wide; a stock count is per branch.
    case "updateMedicine":
      return p.stock !== undefined;
    case "addMedicine":
      return Number(p.stock) > 0;
    default:
      return false;
  }
}

export async function POST(req: Request) {
  try {
    const { action, payload, since } = await req.json();
    const handler = handlers[action];
    if (!handler) {
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 },
      );
    }
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const locked = await lockedOut(session);
    if (locked) return locked;
    const actionPermission = ACTION_PERMISSIONS[action];
    const allowed =
      hasPermission(session.role, "clinic.mutate.all") ||
      (actionPermission && hasPermission(session.role, actionPermission));
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const branch = await branchContext(session);
    // An admin looking at "All branches" sees combined stock and queues, so
    // work that belongs to one branch's shelf, drawer or queue must wait until
    // they pick which branch they mean.
    if (branch.viewBranchId === null && needsBranch(action, payload)) {
      return NextResponse.json(
        { error: "You're viewing all branches — pick a branch in the sidebar first." },
        { status: 409 },
      );
    }
    const stamp = SESSION_STAMPS[action];
    const input = stamp
      ? { ...(payload as object), ...stamp(session, branch) }
      : payload;
    const result = await handler(input);
    // A rejected mutation (e.g. doctor already busy) reports { error }.
    if (result && typeof result === "object" && "error" in result) {
      return NextResponse.json(result, { status: 409 });
    }
    // Import acknowledgements must not depend on a subsequent clinic refresh.
    if (action === "importMedicines") return NextResponse.json(result);
    // Reply with just what changed since the client's last sync — the action's
    // own writes included — instead of re-sending the whole clinic.
    const data = await repo.getClinicData({
      includeFinance: hasPermission(session.role, "clinic.finance.manage"),
      since: parseSince(since),
      userId: session.id,
      branch,
    });
    return NextResponse.json(data);
  } catch (err) {
    console.error("POST /api/clinic failed", err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
