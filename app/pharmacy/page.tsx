"use client";

import { useState } from "react";
import { checkoutVisit, dispenseAndClose, useClinic } from "@/lib/store";
import type {
  ID,
  Med,
  Medicine,
  Order,
  PaymentMethod,
  Visit,
} from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  LocationBadge,
  PageHeader,
  cn,
  inputClass,
} from "@/components/ui";
import {
  chargesTotal,
  ordersForVisit,
  outstandingCharges,
  patientMap,
  patientName,
  visitLocation,
  visitsByStatus,
} from "@/lib/selectors";
import { StkBanner, useStkEnabled, useStkPush } from "@/components/MpesaPrompt";
import {
  METHODS,
  ReceiptCard,
  type Receipt,
  medicineLabel,
  money,
} from "@/components/SaleReceipt";

/** Units prescribed per catalog medicine; null when a legacy line has no
 *  catalog link (then the shelf search stays available). Same rule as the
 *  server's prescribedAllowance, which checkout enforces. */
function prescribedAllowanceOf(meds: Med[]): Map<ID, number> | null {
  const allowance = new Map<ID, number>();
  for (const m of meds) {
    if (!m.medicineId) return null;
    const qty = m.quantity ?? Number.POSITIVE_INFINITY;
    allowance.set(m.medicineId, (allowance.get(m.medicineId) ?? 0) + qty);
  }
  return allowance;
}

export default function PharmacyPage() {
  const data = useClinic();
  const pmap = patientMap(data);
  const queue = visitsByStatus(data, "awaiting-pharmacy");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // PayHero credentials present? If not, M-Pesa falls back to manual entry.
  const stkEnabled = useStkEnabled();

  return (
    <div>
      <PageHeader
        title="Pharmacy"
        subtitle="Hand over what the doctor prescribed, take payment, and close the visit"
      />

      {receipt && (
        <ReceiptCard receipt={receipt} onDismiss={() => setReceipt(null)} />
      )}

      {queue.length === 0 ? (
        <EmptyState>No prescriptions waiting to be dispensed.</EmptyState>
      ) : (
        <div className="grid gap-4">
          {queue.map((visit) => (
            <PosCard
              key={visit.id}
              visit={visit}
              patientLabel={patientName(pmap.get(visit.patientId))}
              mrn={pmap.get(visit.patientId)?.mrn ?? ""}
              prescriptions={ordersForVisit(data, visit.id).filter(
                (o) => o.type === "prescription",
              )}
              stkEnabled={stkEnabled}
              onPaid={setReceipt}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One patient's point of sale: the doctor's prescription as a reference,
 *  a catalog search, a cart, and checkout. */
function PosCard({
  visit,
  patientLabel,
  mrn,
  prescriptions,
  stkEnabled,
  onPaid,
}: {
  visit: Visit;
  patientLabel: string;
  mrn: string;
  prescriptions: Order[];
  stkEnabled: boolean;
  onPaid: (r: Receipt) => void;
}) {
  const data = useClinic();
  const [query, setQuery] = useState("");
  const prescribed = prescriptions.flatMap((o) => o.meds ?? []);
  // What the doctor prescribed, medicineId → units (mirrors the server's
  // prescribedAllowance). null = an old prescription line not tied to the
  // catalog, so the pharmacist has to find it on the shelf the old way.
  const allowance = prescribedAllowanceOf(prescribed);
  const allowedQty = (id: ID) => allowance?.get(id) ?? Number.POSITIVE_INFINITY;
  // The cart starts as the prescription itself — the pharmacist hands it over.
  const [cart, setCart] = useState<Map<ID, number>>(() => {
    const initial = new Map<ID, number>();
    for (const [id, qty] of allowance ?? []) {
      const stock = data.medicines.find((m) => m.id === id)?.stock ?? 0;
      const give = Math.min(Number.isFinite(qty) ? qty : 1, stock);
      if (give > 0) initial.set(id, give);
    }
    return initial;
  }); // medicineId → qty
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catalog = new Map(data.medicines.map((m) => [m.id, m]));

  const q = query.trim().toLowerCase();
  const results = q
    ? data.medicines
        .filter((m) =>
          `${m.name} ${m.strength} ${m.form}`.toLowerCase().includes(q),
        )
        .slice(0, 6)
    : [];

  const setQty = (id: ID, qty: number) =>
    setCart((c) => {
      const next = new Map(c);
      if (qty <= 0) next.delete(id);
      else next.set(id, qty);
      return next;
    });
  const addToCart = (m: Medicine) => {
    setQty(m.id, Math.min((cart.get(m.id) ?? 0) + 1, m.stock, allowedQty(m.id)));
    setQuery("");
  };
  // Put a prescribed line back after the pharmacist removed it.
  const restoreLine = (m: Medicine) => {
    const qty = allowedQty(m.id);
    setQty(m.id, Math.min(Number.isFinite(qty) ? qty : 1, m.stock));
  };

  const cartLines = [...cart.entries()]
    .map(([id, qty]) => ({ med: catalog.get(id), qty }))
    .filter((l): l is { med: Medicine; qty: number } => !!l.med);
  const cartTotal = cartLines.reduce((s, l) => s + l.qty * l.med.unitPrice, 0);

  // Everything the patient still owes from earlier stages. In per-stage
  // billing this is empty (reception already collected); in pay-at-end it is
  // the consultation and any tests, all settled here in one go.
  const owed = outstandingCharges(visit);
  const total = cartTotal + chargesTotal(owed);

  const inStock = cartLines.every((l) => l.qty <= l.med.stock);
  const stkFlow = method === "mpesa" && stkEnabled;
  const needsReference = method !== "cash" && !stkFlow;
  const cashAmount = Number(cashReceived);
  const cashValid =
    method !== "cash" ||
    (cashReceived.trim() !== "" &&
      Number.isFinite(cashAmount) &&
      cashAmount >= total);
  const change = method === "cash" && cashValid ? cashAmount - total : 0;
  // A patient who was never prescribed anything still has to settle their
  // bill, so an empty cart is fine as long as something is outstanding.
  const hasSomethingToSettle = cartLines.length > 0 || owed.length > 0;
  // …and with nothing carted and nothing owed there is no money to take: the
  // desk just closes the visit. That covers "nothing prescribed" as well as
  // every prescribed item being out of stock or declined by the patient.
  const nothingToCollect = !hasSomethingToSettle;
  const ready =
    hasSomethingToSettle &&
    inStock &&
    cashValid &&
    (!needsReference || reference.trim() !== "");

  const checkout = async (serverReference?: string, shownReference?: string) => {
    setBusy(true);
    setError(null);
    const err = await checkoutVisit(
      visit.id,
      method,
      serverReference ?? reference,
      cartLines.map((l) => ({ medicineId: l.med.id, quantity: l.qty })),
    );
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onPaid({
      patient: patientLabel,
      mrn,
      items: [
        // Earlier stages first — the receipt then reads in the order the
        // patient actually ran the charges up.
        ...owed.map((c) => ({
          name: c.description,
          quantity: 1,
          unitPrice: c.amount,
        })),
        ...cartLines.map((l) => ({
          name: medicineLabel(l.med),
          quantity: l.qty,
          unitPrice: l.med.unitPrice,
        })),
      ],
      total,
      method,
      reference: shownReference ?? serverReference ?? reference.trim(),
      cashReceived: method === "cash" ? cashAmount : undefined,
      change: method === "cash" ? change : undefined,
      at: new Date(),
    });
  };

  /** Close a visit with nothing to dispense and nothing left to pay. The
   *  server refuses if anything is still outstanding, so no bill can be
   *  walked out of here. */
  const closeWithoutSale = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await dispenseAndClose(visit.id);
    setBusy(false);
    if (err) setError(err);
  };

  // Payment confirmed on the customer's phone → finish the sale automatically.
  const {
    stk,
    busy: stkBusy,
    error: stkError,
    request,
    reset: resetStk,
  } = useStkPush((checkoutRequestId, receipt) =>
    void checkout(checkoutRequestId, receipt),
  );

  const requestStk = () =>
    void request({
      phone,
      accountReference: mrn || "AmlaMedicare",
      // The server re-prices the cart and adds whatever the visit still owes,
      // so the pushed amount always matches what checkout expects.
      visitId: visit.id,
      items: cartLines.map((l) => ({
        medicineId: l.med.id,
        quantity: l.qty,
      })),
    });

  const shownError = error ?? stkError;

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{patientLabel}</h2>
          <p className="text-sm text-zinc-500">
            {mrn} · {visit.complaint || "—"}
          </p>
        </div>
        <LocationBadge location={visitLocation(data, visit)} />
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        {/* Left: what the doctor prescribed + catalog search */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-zinc-700">
            Prescription
          </h3>
          {prescribed.length === 0 ? (
            <p className="text-sm text-zinc-500">No prescription lines.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm text-zinc-700">
              {prescribed.map((m: Med) => {
                const stockItem = m.medicineId ? catalog.get(m.medicineId) : undefined;
                const inCart = stockItem ? cart.get(stockItem.id) ?? 0 : 0;
                return (
                <li key={m.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <span>
                      <strong className="text-foreground">{m.name}</strong>
                      <span className="mt-1 block text-xs text-muted-foreground">{m.dosage} · {m.frequency} · {m.duration}</span>
                      {m.quantity != null && (
                        <span className="mt-1 block text-xs font-medium text-teal-700 dark:text-teal-400">Give {m.quantity}</span>
                      )}
                    </span>
                    {stockItem ? (
                      stockItem.stock <= 0 ? (
                        <span className="rounded-full border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/60 px-2 py-1 text-xs text-red-700 dark:text-red-300">Out of stock</span>
                      ) : inCart > 0 ? (
                        <span className="rounded-full border border-teal-200 dark:border-teal-900/50 bg-teal-50 dark:bg-teal-950/60 px-2 py-1 text-xs text-teal-700 dark:text-teal-300">In cart</span>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => restoreLine(stockItem)}>
                          Add back
                        </Button>
                      )
                    ) : (
                      <span className="rounded-full border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/60 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">Legacy · search shelf</span>
                    )}
                  </div>
                </li>
              )})}
            </ul>
          )}

          {/* Only the doctor decides what the patient gets. The shelf search
              survives solely for old prescriptions written as free text. */}
          {allowance === null && (
          <>
          <h3 className="mb-2 mt-4 text-sm font-semibold text-zinc-700">
            Find medicine
          </h3>
          <input
            className={`${inputClass} w-full`}
            placeholder="Search the shelf… e.g. amox"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          </>
          )}
          {allowance === null && q && (
            <ul className="mt-2 flex flex-col gap-1">
              {results.length === 0 && (
                <li className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
                  Nothing on the shelf matches “{query}”.
                </li>
              )}
              {results.map((m) => {
                const out = m.stock <= (cart.get(m.id) ?? 0);
                return (
                  <li
                    key={m.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  >
                    <span>
                      <strong>{medicineLabel(m)}</strong>{" "}
                      <span className="text-zinc-500">
                        · {m.form} · {money(m.unitPrice)} ·{" "}
                        {m.stock > 0 ? `${m.stock} in stock` : "out of stock"}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={out}
                      onClick={() => addToCart(m)}
                    >
                      {out ? "Out of stock" : "Add"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Right: cart + payment */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-zinc-700">
            Cart ({cartLines.length})
          </h3>
          {cartLines.length === 0 && (
            <p className="rounded-lg bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500">
              {owed.length > 0
                ? "Nothing to dispense — you can still settle the bill below."
                : allowance === null
                  ? "Search the shelf and add medicines to the cart."
                  : "Nothing to hand over."}
            </p>
          )}
          {cartLines.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {cartLines.map(({ med, qty }) => (
                <li
                  key={med.id}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2"
                >
                  <span className="flex-1">
                    <strong>{medicineLabel(med)}</strong>{" "}
                    <span className="text-zinc-500">
                      @ {money(med.unitPrice)}
                    </span>
                  </span>
                  <input
                    className={`${inputClass} h-8 w-16 px-2`}
                    type="number"
                    min={1}
                    max={Math.min(med.stock, allowedQty(med.id))}
                    value={qty}
                    onChange={(e) =>
                      setQty(
                        med.id,
                        // Can give less than prescribed, never more.
                        Math.min(Number(e.target.value) || 0, med.stock, allowedQty(med.id)),
                      )
                    }
                  />
                  {Number.isFinite(allowedQty(med.id)) && (
                    <span className="text-xs text-zinc-400">/ {allowedQty(med.id)}</span>
                  )}
                  <span className="w-24 text-right font-medium">
                    {money(qty * med.unitPrice)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setQty(med.id, 0)}
                  >
                    ✕
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* Charges run up earlier in the visit. Only pay-at-end patients
              reach the POS still owing for these. */}
          {owed.length > 0 && (
            <div className="mt-3">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
                Owing from earlier
              </h4>
              <ul className="flex flex-col gap-1 text-sm">
                {owed.map((c) => (
                  <li
                    key={c.id}
                    className="flex justify-between rounded-lg bg-amber-50 px-3 py-2"
                  >
                    <span className="text-amber-900">{c.description}</span>
                    <span className="tabular-nums text-amber-900">
                      {money(c.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasSomethingToSettle && (
            <div className="mt-2 flex justify-between border-t border-zinc-200 px-3 pt-2 text-base font-semibold">
              <span>Total due</span>
              <span className="tabular-nums text-teal-700">{money(total)}</span>
            </div>
          )}

          {/* Nothing to dispense and nothing owed — there is no payment to
              take, so the till hides itself and just offers the exit. */}
          {nothingToCollect && (
            <p className="mt-3 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600">
              {prescribed.length === 0
                ? "Nothing was prescribed and the bill is fully settled — there is no money left to take."
                : "Nothing is being handed over and the bill is settled. Closing ends the visit without handing anything over."}
            </p>
          )}

          <div
            className={cn(
              "mt-3 grid gap-3 sm:grid-cols-2",
              nothingToCollect && "hidden",
            )}
          >
            <Field label="Payment method">
              <select
                className={inputClass}
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value as PaymentMethod);
                  setCashReceived("");
                  resetStk();
                  setError(null);
                }}
              >
                {METHODS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            {method === "cash" ? (
              <Field label="Cash received (KSh)">
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder={`At least ${total.toLocaleString("en-KE")}`}
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                />
              </Field>
            ) : stkFlow ? (
              <Field label="Customer phone (Safaricom)">
                <input
                  className={inputClass}
                  placeholder="e.g. 0712 345678"
                  value={phone}
                  disabled={stk?.status === "pending"}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
            ) : (
              <Field
                label={
                  method === "mpesa"
                    ? "M-Pesa code"
                    : method === "card"
                      ? "Card reference"
                      : "Reference (optional)"
                }
              >
                <input
                  className={inputClass}
                  placeholder={method === "mpesa" ? "e.g. SGH4X2K9QT" : ""}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
            )}
          </div>

          {method === "cash" && cashReceived.trim() !== "" && (
            cashValid ? (
              <div className="mt-3 flex items-center justify-between rounded-lg bg-teal-50 p-3 text-sm text-teal-900">
                <span>Change to return</span>
                <strong className="tabular-nums">{money(change)}</strong>
              </div>
            ) : (
              <div className="mt-3 flex items-center justify-between rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <span>Cash is short by</span>
                <strong className="tabular-nums">
                  {money(Math.max(0, total - (Number.isFinite(cashAmount) ? cashAmount : 0)))}
                </strong>
              </div>
            )
          )}

          {shownError && (
            <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {shownError}
            </p>
          )}

          {stkFlow && stk && (
            <StkBanner
              stk={stk}
              phone={phone}
              onReset={resetStk}
              success={
                error ? (
                  <>
                    the visit did not close.{" "}
                    <button
                      className="underline"
                      disabled={busy}
                      onClick={() =>
                        void checkout(stk.id, stk.receipt ?? stk.id)
                      }
                    >
                      Retry closing the visit
                    </button>
                  </>
                ) : (
                  "closing the visit…"
                )
              }
            />
          )}

          {nothingToCollect ? (
            <Button
              className="mt-4 w-full"
              variant="secondary"
              disabled={busy}
              onClick={closeWithoutSale}
            >
              {busy ? "Closing…" : "Close visit — nothing to collect"}
            </Button>
          ) : stkFlow ? (
            <Button
              className="mt-4 w-full"
              disabled={
                !ready ||
                busy ||
                stkBusy ||
                !phone.trim() ||
                stk?.status === "pending" ||
                stk?.status === "success"
              }
              onClick={requestStk}
            >
              {!hasSomethingToSettle
                ? "Add the prescribed medicines to the cart"
                : !inStock
                  ? "Not enough stock for the cart"
                  : !phone.trim()
                    ? "Enter the customer's phone number"
                    : stk?.status === "pending"
                      ? "Waiting for M-Pesa…"
                      : `Request ${money(Math.max(1, Math.round(total)))} via M-Pesa`}
            </Button>
          ) : (
            <Button
              className="mt-4 w-full"
              disabled={!ready || busy}
              onClick={() => checkout()}
            >
              {!hasSomethingToSettle
                ? "Add the prescribed medicines to the cart"
                : !inStock
                  ? "Not enough stock for the cart"
                  : needsReference && !reference.trim()
                    ? "Enter the payment reference"
                    : method === "cash" && !cashReceived.trim()
                      ? "Enter cash received"
                      : method === "cash" && !cashValid
                        ? "Cash received is not enough"
                    : method === "cash" && cashValid && change > 0
                      ? `Take cash · return ${money(change)}`
                      : `Take ${money(total)} & close visit`}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

