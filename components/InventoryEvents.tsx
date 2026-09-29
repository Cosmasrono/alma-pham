"use client";

// Shared pieces of the inventory audit trail: event labels, the fetch, and
// one event row — used by the dashboard's activity section and the full
// stock log page.

import { cn } from "@/components/ui";

export type EventType =
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

export interface InventoryEventRow {
  id: string;
  type: EventType;
  medicineId: string;
  medicineName: string;
  branchId: string | null;
  quantity: number;
  stockAfter: number | null;
  details: string | null;
  reference: string | null;
  byName: string | null;
  flagged: boolean;
  flagReason: string | null;
  createdAt: string;
}

export interface InventoryLog {
  from: number;
  to: number;
  branchId: string | null;
  flaggedCount: number;
  totals: { branchId: string | null; type: EventType; units: number; count: number }[];
  events: InventoryEventRow[];
}

export const EVENT_LABELS: Record<EventType, string> = {
  sale: "Sold",
  receive: "Received",
  adjust: "Manual count",
  "write-off": "Written off",
  "transfer-out": "Sent out",
  "transfer-in": "Transferred in",
  import: "Bulk import",
  opening: "Opening stock",
  price: "Price change",
  edit: "Details edited",
};

const EVENT_STYLE: Record<EventType, string> = {
  sale: "bg-sky-50 text-sky-800",
  receive: "bg-emerald-50 text-emerald-800",
  adjust: "bg-amber-50 text-amber-800",
  "write-off": "bg-rose-50 text-rose-800",
  "transfer-out": "bg-violet-50 text-violet-800",
  "transfer-in": "bg-violet-50 text-violet-800",
  import: "bg-emerald-50 text-emerald-800",
  opening: "bg-zinc-100 text-zinc-700",
  price: "bg-orange-50 text-orange-800",
  edit: "bg-zinc-100 text-zinc-700",
};

export async function fetchInventoryLog(params: Record<string, string | number | undefined>): Promise<InventoryLog> {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  );
  const res = await fetch(`/api/inventory-log?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as InventoryLog;
}

export function EventBadge({ type }: { type: EventType }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", EVENT_STYLE[type])}>
      {EVENT_LABELS[type]}
    </span>
  );
}

/** "+20", "−3", or "" for events that don't move stock. */
export function signedUnits(e: Pick<InventoryEventRow, "quantity" | "type">): string {
  if (e.type === "price" || e.type === "edit" || e.quantity === 0) return "";
  return e.quantity > 0 ? `+${e.quantity}` : `−${Math.abs(e.quantity)}`;
}

/** Compact time for a feed: "14:05" today, "12 Sep 14:05" otherwise. */
export function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
