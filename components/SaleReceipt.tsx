"use client";

// The receipt both pharmacy tills print: the clinic checkout (a visit closing)
// and the walk-in counter (an over-the-counter sale).

import { PrinterIcon } from "lucide-react";
import { Button, Card } from "@/components/ui";
import type { Medicine, PaymentMethod } from "@/lib/types";
import { PREMISES_REG_NO } from "@/lib/brand";

export const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "mpesa", label: "M-Pesa" },
  { key: "card", label: "Card" },
];

export const money = (n: number) =>
  `KSh ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

export const medicineLabel = (m: Medicine) =>
  `${m.name} ${m.strength}`.replace(" —", "").trim();

export interface Receipt {
  walkIn?: boolean; // counter sale rather than a clinic visit
  patient: string;
  mrn: string;
  items: { name: string; quantity: number; unitPrice: number }[];
  total: number;
  method: PaymentMethod;
  reference: string;
  cashReceived?: number;
  change?: number;
  at: Date;
}

/** Confirmation of the last sale — what a printed receipt would show. */
export function ReceiptCard({
  receipt,
  onDismiss,
}: {
  receipt: Receipt;
  onDismiss: () => void;
}) {
  const methodLabel =
    METHODS.find((m) => m.key === receipt.method)?.label ?? receipt.method;
  return (
    <div id="payment-receipt">
      <Card className="mb-6 border-teal-300 bg-teal-50/50">
        <div className="flex items-start justify-between">
          <div>
            <p className="hidden text-center text-lg font-bold text-zinc-900 print:block">
              Amla - Medicare Ltd
            </p>
            <p className="hidden text-center text-xs text-zinc-600 print:block">
              Premises Reg. No. {PREMISES_REG_NO}
            </p>
            <h2 className="text-sm font-semibold text-teal-900 print:mt-2 print:text-zinc-900">
              {receipt.walkIn ? "Payment received — walk-in sale" : "Payment received — visit closed"}
            </h2>
            <p className="mt-1 text-xs text-teal-700">
              {receipt.patient}
              {receipt.mrn ? ` (${receipt.mrn})` : ""} ·{" "}
              {receipt.at.toLocaleTimeString()} · {methodLabel}
              {receipt.reference ? ` · ${receipt.reference}` : ""}
            </p>
          </div>
          <div className="flex gap-2 print:hidden">
            <Button size="sm" variant="secondary" onClick={() => window.print()}>
              <PrinterIcon className="size-4" />
              Print receipt
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
        <ul className="mt-3 flex flex-col gap-1 text-sm text-zinc-700">
          {receipt.items.map((item, i) => (
            <li key={i} className="flex justify-between">
              <span>
                {item.name} × {item.quantity}
              </span>
              <span>{money(item.quantity * item.unitPrice)}</span>
            </li>
          ))}
          <li className="mt-1 flex justify-between border-t border-teal-200 pt-2 font-semibold">
            <span>Total paid</span>
            <span>{money(receipt.total)}</span>
          </li>
          {receipt.method === "cash" && receipt.cashReceived !== undefined && (
            <>
              <li className="flex justify-between text-sm">
                <span>Cash received</span>
                <span>{money(receipt.cashReceived)}</span>
              </li>
              <li className="flex justify-between text-sm font-semibold">
                <span>Change returned</span>
                <span>{money(receipt.change ?? 0)}</span>
              </li>
            </>
          )}
        </ul>
      </Card>
    </div>
  );
}
