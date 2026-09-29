// Inventory security: every change to stock or to a medicine's price/details
// is written to the InventoryEvent log, inside the same transaction as the
// change, together with a red flag when the change deserves a second look.

import { prisma } from "@/lib/prisma";

export type InventoryEventType =
  | "sale"
  | "receive"
  | "adjust"
  | "write-off"
  | "transfer-out"
  | "transfer-in"
  | "import"
  | "opening"
  | "price"
  | "edit";

/** Who made the change and what it belongs to — passed down by callers. */
export interface ChangeContext {
  byName?: string | null;
  byId?: string | null;
  reference?: string | null;
  details?: string | null;
}

// A manual correction this big (units, or share of the count) always gets a
// second look, even when it adds stock.
const BIG_ADJUST_UNITS = 20;
const BIG_ADJUST_SHARE = 0.25;

/** Why a stock change is suspicious, or null. Sales, deliveries and
 *  transfers are routine; hand corrections and write-offs are where stock
 *  quietly disappears. */
export function stockFlag(type: InventoryEventType, delta: number, before: number): string | null {
  if (type === "write-off") return "Stock written off";
  if (type !== "adjust") return null;
  if (delta < 0) return `Manual count reduced by ${-delta}`;
  if (delta >= BIG_ADJUST_UNITS || (before > 0 && delta / before >= BIG_ADJUST_SHARE)) {
    return `Large manual increase (+${delta})`;
  }
  return null;
}

/** Why a price change is suspicious, or null. */
export function priceFlag(
  oldPrice: number,
  newPrice: number,
  cost: number,
): string | null {
  if (newPrice < cost) return `Selling price below cost (KSh ${newPrice} < ${cost})`;
  if (newPrice < oldPrice) return `Selling price cut ${Math.round(((oldPrice - newPrice) / oldPrice) * 100)}%`;
  return null;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma;

export async function logInventoryEvent(
  tx: Tx,
  event: {
    type: InventoryEventType;
    medicineId: string;
    medicineName: string;
    branchId?: string | null;
    quantity?: number;
    stockAfter?: number | null;
    flagReason?: string | null;
  } & ChangeContext,
) {
  await tx.inventoryEvent.create({
    data: {
      type: event.type,
      medicineId: event.medicineId,
      medicineName: event.medicineName,
      branchId: event.branchId ?? null,
      quantity: event.quantity ?? 0,
      stockAfter: event.stockAfter ?? null,
      details: event.details?.slice(0, 300) ?? null,
      reference: event.reference?.slice(0, 120) ?? null,
      byName: event.byName ?? null,
      // The developer's placeholder id isn't a real user — don't pin it.
      byId: event.byId && event.byId !== "000000000000000000000000" ? event.byId : null,
      flagged: Boolean(event.flagReason),
      flagReason: event.flagReason ?? null,
    },
  });
}
