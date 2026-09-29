"use client";

// Stock arrives in batches: each delivery carries its own batch number and
// expiry date. Sales draw the earliest-expiring batch down first and expired
// stock is blocked, so the shelf clears in the right order.

import { useState } from "react";
import { receiveStock, useClinic, writeOffBatch } from "@/lib/store";
import type { ID, Medicine, MedicineBatch } from "@/lib/types";
import { Button, Field, cn, inputClass } from "@/components/ui";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days until a batch expires; null when it carries no expiry date. */
export function daysLeft(batch: MedicineBatch): number | null {
  if (!batch.expiryDate) return null;
  return Math.ceil((new Date(batch.expiryDate).getTime() - Date.now()) / DAY_MS);
}

/** Batches of one medicine, earliest expiry first — the order they sell in. */
export function batchesOf(batches: MedicineBatch[], medicineId: ID): MedicineBatch[] {
  return batches
    .filter((b) => b.medicineId === medicineId && b.quantity > 0)
    .sort((a, b) => (a.expiryDate ?? "9999").localeCompare(b.expiryDate ?? "9999"));
}

function expiryStyle(days: number | null) {
  if (days === null) return { label: "No expiry recorded", cls: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400" };
  if (days <= 0) return { label: "Expired", cls: "bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/60" };
  if (days <= 30) return { label: `${days}d left`, cls: "bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/50" };
  if (days <= 90) return { label: `${days}d left`, cls: "bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/50" };
  return { label: new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10), cls: "bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-900/50" };
}

/** Book a delivery in and list what is already on the shelf for this medicine. */
export function StockBatchesPanel({ medicine }: { medicine: Medicine }) {
  const data = useClinic();
  const batches = batchesOf(data.batches, medicine.id);

  const [quantity, setQuantity] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const receive = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    const err = await receiveStock({
      medicineId: medicine.id,
      quantity: Number(quantity),
      batchNumber,
      expiryDate: expiryDate || undefined,
      costPrice: costPrice.trim() === "" ? undefined : Number(costPrice),
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setSaved(`${quantity} unit(s) received.`);
    setQuantity("");
    setBatchNumber("");
    setExpiryDate("");
    setCostPrice("");
  };

  const writeOff = async (batch: MedicineBatch) => {
    if (!confirm(`Remove ${batch.quantity} unit(s) of this batch from stock?`)) return;
    const err = await writeOffBatch(batch.id, "expired or damaged");
    if (err) setError(err);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 p-3">
        <p className="mb-2 text-xs font-bold text-zinc-700 dark:text-zinc-300">Receive a delivery</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Units received">
            <input
              className={cn(inputClass, "h-9 text-xs")}
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 200"
            />
          </Field>
          <Field label="Expiry date">
            <input
              className={cn(inputClass, "h-9 text-xs")}
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </Field>
          <Field label="Batch number">
            <input
              className={cn(inputClass, "h-9 text-xs")}
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value)}
              placeholder="e.g. B2431"
            />
          </Field>
          <Field label="Cost per unit (KSh)">
            <input
              className={cn(inputClass, "h-9 text-xs")}
              type="number"
              min="0"
              step="0.01"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
              placeholder={String(medicine.costPrice || "")}
            />
          </Field>
        </div>
        {error && <p className="mt-2 rounded bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 p-2 text-xs text-red-700 dark:text-red-300">{error}</p>}
        {saved && <p className="mt-2 rounded bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-900/50 p-2 text-xs text-teal-800 dark:text-teal-300">{saved}</p>}
        <Button
          type="button"
          size="sm"
          className="mt-2 w-full"
          disabled={busy || !quantity.trim()}
          onClick={receive}
        >
          {busy ? "Receiving…" : "Add to stock"}
        </Button>
      </div>

      <div>
        <p className="mb-1 text-xs font-bold text-zinc-700 dark:text-zinc-300">
          On the shelf ({batches.length} batch{batches.length === 1 ? "" : "es"})
        </p>
        {batches.length === 0 ? (
          <p className="rounded-lg bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800 px-3 py-3 text-xs text-zinc-500 dark:text-zinc-400">
            No batches recorded. Until a delivery is received here, the counter sells against the
            plain stock count with no expiry checks.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
            {batches.map((b) => {
              const days = daysLeft(b);
              const style = expiryStyle(days);
              return (
                <li key={b.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <strong className="tabular-nums text-foreground">{b.quantity}</strong> units
                    {b.batchNumber ? ` · batch ${b.batchNumber}` : ""}
                    <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">
                      received {new Date(b.receivedAt).toLocaleDateString()}
                      {b.receivedBy ? ` by ${b.receivedBy}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={cn("rounded px-1.5 py-0.5 font-semibold", style.cls)}>
                      {style.label}
                    </span>
                    <button
                      className="text-[11px] text-rose-700 dark:text-rose-400 hover:underline"
                      onClick={() => void writeOff(b)}
                    >
                      Write off
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
