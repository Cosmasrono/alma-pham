"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, ScanBarcode, ShoppingBag, Plus, Minus, Check, Pill, ArrowUp, X } from "lucide-react";
import {
  closeShift,
  openShift,
  sellWalkIn,
  useClinic,
} from "@/lib/store";
import type { ID, Medicine, PaymentMethod, Shift } from "@/lib/types";
import { Button, Card, Field, PageHeader, cn, inputClass } from "@/components/ui";
import { StkBanner, useStkEnabled, useStkPush } from "@/components/MpesaPrompt";
import {
  METHODS,
  ReceiptCard,
  type Receipt,
  medicineLabel,
  money,
} from "@/components/SaleReceipt";

/** Units of a medicine that may actually be sold: in-date batch stock where
 *  batches are used, otherwise the plain catalog count. */
function sellableOf(m: Medicine): number {
  return m.sellable ?? m.stock;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days until this medicine's earliest-expiring stock goes out of date. */
function daysToExpiry(m: Medicine): number | null {
  if (!m.nextExpiry) return null;
  return Math.ceil((new Date(m.nextExpiry).getTime() - Date.now()) / DAY_MS);
}

export default function WalkInPage() {
  const data = useClinic();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // A new key per sale gives the next customer a fresh, empty counter.
  const [sales, setSales] = useState(0);
  const [showTill, setShowTill] = useState(false);
  const shift = data.myShift ?? null;
  const branch = data.branches.find((b) => b.id === data.viewBranchId);

  // "All branches" shows combined stock — a sale has to come off one shelf.
  if (data.canSwitchBranch && data.viewBranchId === null && data.branches.length > 0) {
    return (
      <div>
        <PageHeader
          title="Walk-in counter"
          subtitle="Sell over the counter to customers who came only to buy medicine"
        />
        <Card>
          <p className="text-sm text-zinc-600">
            You&apos;re viewing <strong>all branches</strong>. Pick the branch you&apos;re selling
            at in the sidebar — the counter sells from that branch&apos;s shelf and till.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Walk-in counter"
        subtitle={
          branch && data.branches.filter((b) => b.active).length > 1
            ? `${branch.name} · find medicines, build a sale, and take payment.`
            : "Find medicines, build a sale, and take payment."
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        {shift ? (
          <p className="text-sm text-muted-foreground">
            Till open since{" "}
            <strong className="text-foreground">{new Date(shift.openedAt).toLocaleTimeString()}</strong> · float{" "}
            <strong className="text-foreground">{money(shift.openingCash)}</strong> · cash taken{" "}
            <strong className="text-teal-700 dark:text-teal-400">{money(shift.totalCashSales)}</strong>
          </p>
        ) : (
          <p className="text-sm text-amber-800 dark:text-amber-300">
            No till open. You can still sell — open one to reconcile your cash at the end.
          </p>
        )}
        <Button variant={shift ? "secondary" : "primary"} size="sm" onClick={() => setShowTill(true)}>
          {shift ? "Close till" : "Open till"}
        </Button>
      </div>

      {receipt && <ReceiptCard receipt={receipt} onDismiss={() => setReceipt(null)} />}

      <Counter
        key={sales}
        onPaid={(r) => {
          setReceipt(r);
          setSales((n) => n + 1);
        }}
      />

      {showTill && <TillModal shift={shift} onClose={() => setShowTill(false)} />}
    </div>
  );
}

/** Shelf + cart + payment. */
function Counter({ onPaid }: { onPaid: (r: Receipt) => void }) {
  const data = useClinic();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [visibleCount, setVisibleCount] = useState(36);
  const [cart, setCart] = useState<Map<ID, number>>(new Map()); // medicineId → qty
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [prescriber, setPrescriber] = useState("");
  const [facility, setFacility] = useState("");
  const [showPay, setShowPay] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const catalog = useMemo(
    () => new Map(data.medicines.map((m) => [m.id, m])),
    [data.medicines],
  );

  // Name, generic name, form or barcode — the same box the scanner types into.
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const list = q
      ? data.medicines.filter((m) =>
          `${m.name} ${m.strength} ${m.form} ${m.genericName ?? ""} ${m.barcode ?? ""}`
            .toLowerCase()
            .includes(q),
        )
      : data.medicines;
    return list.filter((m) => filter === "all" || (filter === "in-stock" ? sellableOf(m) > 0 : m.form === filter));
  }, [data.medicines, q, filter]);
  const shelf = matches.slice(0, visibleCount);

  const setQty = (id: ID, qty: number) =>
    setCart((c) => {
      const next = new Map(c);
      if (qty <= 0) next.delete(id);
      else next.set(id, qty);
      return next;
    });

  const addToCart = (m: Medicine) => {
    const limit = sellableOf(m);
    const have = cart.get(m.id) ?? 0;
    if (have + 1 > limit) {
      setMsg(`Only ${limit} sellable unit(s) of ${medicineLabel(m)} left.`);
      return;
    }
    setMsg(null);
    setQty(m.id, have + 1);
    setQuery("");
    searchRef.current?.focus();
  };

  // A barcode scanner types the code then presses Enter — add that item.
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const code = query.trim();
    if (!code) return;
    const exact =
      data.medicines.find((m) => m.barcode && m.barcode === code) ??
      (matches.length === 1 ? matches[0] : undefined);
    if (exact) addToCart(exact);
    else setMsg(`Nothing on the shelf matches “${code}”.`);
  };

  const cartLines = [...cart.entries()]
    .map(([id, qty]) => ({ med: catalog.get(id), qty }))
    .filter((l): l is { med: Medicine; qty: number } => !!l.med);
  const total = cartLines.reduce((s, l) => s + l.qty * l.med.unitPrice, 0);
  const rxLines = cartLines.filter((l) => l.med.requiresPrescription);
  const needsRx = rxLines.length > 0;
  const rxComplete = !needsRx || (prescriber.trim() !== "" && facility.trim() !== "");
  const inStock = cartLines.every((l) => l.qty <= sellableOf(l.med));

  return (
    <div className="grid grid-cols-1 items-start gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_360px] lg:pb-0 xl:grid-cols-[minmax(0,1fr)_400px]">
      <section id="medicine-catalogue" aria-label="Medicine catalogue" className="min-w-0 space-y-4 scroll-mt-6">
        <div className="rounded-2xl border border-border bg-card p-4">
        <label htmlFor="medicine-search" className="mb-2 block text-sm font-semibold text-foreground">Find a medicine</label>
        <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-3.5 size-5 text-muted-foreground" />
        <input
          id="medicine-search"
          ref={searchRef}
          className="h-12 w-full rounded-xl border border-border bg-zinc-50 dark:bg-zinc-900 pl-11 pr-11 text-base text-foreground placeholder:text-muted-foreground focus:border-teal-600 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
          placeholder="Name, generic name, or barcode"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setVisibleCount(36); }}
          onKeyDown={onSearchKey}
          autoFocus
        />
        <ScanBarcode aria-hidden="true" className="pointer-events-none absolute right-3.5 top-3.5 size-5 text-muted-foreground" />
        </div>
        <div aria-label="Filter medicines" className="mt-3 flex flex-wrap gap-2">
          {[["all", "All medicines"], ["in-stock", "In stock"], ["tablet", "Tablets"], ["capsule", "Capsules"], ["syrup", "Syrups"]].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setVisibleCount(36); }} className={cn("min-h-9 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors", filter === value ? "border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300" : "border-transparent text-muted-foreground hover:bg-muted")}>
              {label}
            </button>
          ))}
        </div>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground" aria-live="polite">
          <span>{matches.length} {matches.length === 1 ? "medicine" : "medicines"}{q ? " found" : " available"}</span>
          <span>Select a medicine to add it</span>
        </div>
        {msg && (
          <p role="status" className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">{msg}</p>
        )}

        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 2xl:grid-cols-3">
          {shelf.map((m) => {
            const left = sellableOf(m);
            const days = daysToExpiry(m);
            const expiringSoon = days !== null && days <= 90;
            return (
              <button
                key={m.id}
                onClick={() => addToCart(m)}
                disabled={left <= 0}
                aria-label={`Add ${medicineLabel(m)}, ${money(m.unitPrice)}${cart.has(m.id) ? `, ${cart.get(m.id)} in sale` : ""}`}
                className={cn("group flex flex-col rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:bg-zinc-100 dark:disabled:bg-zinc-900/50 disabled:opacity-50", cart.has(m.id) ? "border-teal-500 bg-teal-50/60 dark:bg-teal-950/40 ring-1 ring-teal-500/20" : "border-border bg-card enabled:hover:border-teal-400 dark:enabled:hover:border-teal-600 enabled:hover:bg-teal-50/30 dark:enabled:hover:bg-teal-950/20")}
              >
                <div className="mb-3 flex w-full items-center justify-between gap-2">
                  <span className="grid size-9 place-items-center rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300"><Pill aria-hidden="true" className="size-4" /></span>
                  {cart.has(m.id) && <span className="flex items-center gap-1 text-xs font-medium text-teal-800 dark:text-teal-300"><Check aria-hidden="true" className="size-3.5" />{cart.get(m.id)} in sale</span>}
                </div>
                <div className="text-sm font-semibold leading-relaxed text-foreground">
                  {medicineLabel(m)}
                </div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {m.form}
                  {m.genericName ? ` · ${m.genericName}` : ""}
                </div>
                <div className="mt-auto flex w-full flex-wrap items-center justify-between gap-2 pt-4">
                  <span className="text-base font-semibold tabular-nums text-teal-800 dark:text-teal-400">{money(m.unitPrice)}</span>
                  <span
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-medium",
                      left <= 0
                        ? "bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300"
                        : left <= (m.reorderLevel ?? 10)
                          ? "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
                    )}
                  >
                    {left <= 0 ? "Out of stock" : `${left} left`}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.requiresPrescription && (
                    <span className="rounded bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/50 px-1.5 py-1 text-xs font-medium text-rose-700 dark:text-rose-300">
                      Rx only
                    </span>
                  )}
                  {expiringSoon && (
                    <span className="rounded bg-orange-50 dark:bg-orange-950/50 border border-orange-200 dark:border-orange-900/50 px-1.5 py-1 text-xs font-medium text-orange-700 dark:text-orange-300">
                      {days! <= 0 ? "expired stock" : `expires in ${days}d`}
                    </span>
                  )}
                  {(m.expired ?? 0) > 0 && (
                    <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                      {m.expired} blocked
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {shelf.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-border bg-card px-4 py-12 text-center">
              <Search aria-hidden="true" className="mx-auto mb-3 size-6 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">{data.medicines.length === 0 ? "No medicines on this shelf yet" : "No matching medicines"}</p>
              <p className="mt-2 text-sm text-muted-foreground">{data.medicines.length === 0 ? "Add stock to the medicine catalogue to start selling." : "Try another name or barcode, or change the filter."}</p>
              {(query || filter !== "all") && <Button variant="secondary" className="mt-4" onClick={() => { setQuery(""); setFilter("all"); }}>Clear search and filters</Button>}
            </div>
          )}
        </div>
        {matches.length > shelf.length && <Button variant="secondary" className="w-full" onClick={() => setVisibleCount((count) => count + 36)}>Show more medicines ({matches.length - shelf.length} remaining)</Button>}
      </section>

      <section id="current-sale" aria-label="Current sale" tabIndex={-1} className="min-w-0 scroll-mt-6 lg:sticky lg:top-6">
        <a href="#medicine-catalogue" className="mb-3 flex min-h-11 items-center gap-2 text-sm font-medium text-teal-800 dark:text-teal-400 lg:hidden"><ArrowUp aria-hidden="true" className="size-4" />Back to medicines</a>
        <Card className="flex flex-col overflow-hidden !p-0">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-zinc-50/70 dark:bg-zinc-900/50 px-5 py-4">
            <h2 className="flex items-center gap-2 text-base font-semibold"><ShoppingBag aria-hidden="true" className="size-5 text-teal-700 dark:text-teal-400" />Current sale <span className="rounded-md border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground">{cartLines.length}</span></h2>
            {cartLines.length > 0 && (
              <button
                className="min-h-11 px-2 text-sm font-medium text-rose-700 dark:text-rose-400 hover:underline"
                onClick={() => setCart(new Map())}
              >
                Clear
              </button>
            )}
          </div>

          <div className="min-h-0 max-h-[42vh] shrink overflow-y-auto divide-y divide-border">
            {cartLines.map(({ med, qty }) => (
              <div key={med.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-4">
                <div className="col-span-2 min-w-0">
                  <div className="text-sm font-medium leading-relaxed text-foreground">{medicineLabel(med)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{money(med.unitPrice)} each</div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="grid size-11 place-items-center rounded-lg border border-border bg-card hover:bg-muted text-foreground"
                    aria-label={`One less ${medicineLabel(med)}`}
                    onClick={() => setQty(med.id, qty - 1)}
                  >
                    <Minus aria-hidden="true" className="size-4" />
                  </button>
                  <input
                    className="h-11 w-12 rounded-lg border border-border bg-background text-foreground text-center text-sm tabular-nums"
                    inputMode="numeric"
                    value={qty}
                    aria-label={`Quantity of ${medicineLabel(med)}`}
                    onChange={(e) =>
                      setQty(med.id, Math.min(parseInt(e.target.value) || 0, sellableOf(med)))
                    }
                  />
                  <button
                    className="grid size-11 place-items-center rounded-lg border border-border bg-card hover:bg-muted text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={qty >= sellableOf(med)}
                    aria-label={`One more ${medicineLabel(med)}`}
                    onClick={() => addToCart(med)}
                  >
                    <Plus aria-hidden="true" className="size-4" />
                  </button>
                </div>
                <div className="text-right text-sm font-semibold tabular-nums text-foreground">
                  {money(qty * med.unitPrice)}
                </div>
              </div>
            ))}
            {cartLines.length === 0 && (
              <div className="px-5 py-12 text-center">
                <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300"><ShoppingBag aria-hidden="true" className="size-6" /></span>
                <p className="text-sm font-semibold text-foreground">Ready for your next customer</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Select a medicine or scan a barcode to start a sale.</p>
              </div>
            )}
          </div>

          <div className="shrink-0 space-y-4 border-t border-border bg-card p-5">
            {needsRx && (
              <div className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/60 dark:bg-rose-950/40 p-3">
                <p className="text-xs font-semibold text-rose-900 dark:text-rose-300">
                  Prescription-only: {rxLines.map((l) => medicineLabel(l.med)).join(", ")}
                </p>
                <div className="mt-2 grid gap-2">
                  <Field label="Prescribing doctor">
                  <input
                    className={`${inputClass} !py-1.5`}
                    placeholder="Prescribing doctor"
                    value={prescriber}
                    onChange={(e) => setPrescriber(e.target.value)}
                  />
                  </Field>
                  <Field label="Hospital / clinic">
                  <input
                    className={`${inputClass} !py-1.5`}
                    placeholder="Hospital / clinic"
                    value={facility}
                    onChange={(e) => setFacility(e.target.value)}
                  />
                  </Field>
                </div>
              </div>
            )}

            <div className="grid gap-3">
              <Field label="Customer name (optional)">
              <input
                className={`${inputClass} !py-1.5`}
                placeholder="Walk-in customer"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
              </Field>
              <Field label="Phone (optional)">
              <input
                className={`${inputClass} !py-1.5`}
                type="tel"
                placeholder="e.g. 0712 345678"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
              </Field>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-teal-200/60 dark:border-teal-900/50 bg-teal-50/70 dark:bg-teal-950/40 p-4 text-xl font-semibold">
              <span>Total</span>
              <span className="tabular-nums text-teal-700 dark:text-teal-400">{money(total)}</span>
            </div>
            <Button
              className="w-full"
              disabled={cartLines.length === 0 || !inStock || !rxComplete}
              onClick={() => setShowPay(true)}
            >
              {cartLines.length === 0
                ? "Add medicines to the cart"
                : !inStock
                  ? "Not enough sellable stock"
                  : !rxComplete
                    ? "Record the outside prescription"
                    : `Charge ${money(total)}`}
            </Button>
          </div>
        </Card>
      </section>

      {cartLines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur-md py-3 pl-4 pr-24 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgb(0_0_0/0.15)] md:left-56 lg:hidden print:hidden">
          <a href="#current-sale" className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white">
            <span>View sale · {cartLines.length}</span><span className="tabular-nums">{money(total)}</span>
          </a>
        </div>
      )}

      {showPay && (
        <PaymentModal
          total={total}
          items={cartLines.map((l) => ({ medicineId: l.med.id, quantity: l.qty }))}
          receiptItems={cartLines.map((l) => ({
            name: medicineLabel(l.med),
            quantity: l.qty,
            unitPrice: l.med.unitPrice,
          }))}
          customerName={customerName}
          customerPhone={customerPhone}
          prescription={needsRx ? { prescriber, prescriberFacility: facility } : undefined}
          onClose={() => setShowPay(false)}
          onPaid={onPaid}
        />
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-6 text-foreground shadow-2xl backdrop:bg-teal-950/70 backdrop:backdrop-blur-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">{title}</h2>
          <button onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        {children}
    </dialog>
  );
}

/** Takes the money: cash with change due, M-Pesa (prompt or typed code), card. */
function PaymentModal({
  total,
  items,
  receiptItems,
  customerName,
  customerPhone,
  prescription,
  onClose,
  onPaid,
}: {
  total: number;
  items: { medicineId: ID; quantity: number }[];
  receiptItems: { name: string; quantity: number; unitPrice: number }[];
  customerName: string;
  customerPhone: string;
  prescription?: { prescriber: string; prescriberFacility: string };
  onClose: () => void;
  onPaid: (r: Receipt) => void;
}) {
  const stkEnabled = useStkEnabled();
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [phone, setPhone] = useState(customerPhone);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stkFlow = method === "mpesa" && stkEnabled;
  const needsReference = method !== "cash" && !stkFlow;
  const cashAmount = Number(cashReceived);
  const cashValid =
    method !== "cash" ||
    (cashReceived.trim() !== "" && Number.isFinite(cashAmount) && cashAmount >= total);
  const change = method === "cash" && cashValid ? cashAmount - total : 0;

  const sell = async (serverReference?: string, shownReference?: string) => {
    setBusy(true);
    setError(null);
    const err = await sellWalkIn({
      method,
      reference: serverReference ?? reference,
      items,
      customerName,
      customerPhone: phone || customerPhone,
      ...prescription,
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onPaid({
      walkIn: true,
      patient: customerName.trim() || "Walk-in customer",
      mrn: "",
      items: receiptItems,
      total,
      method,
      reference: shownReference ?? serverReference ?? reference.trim(),
      cashReceived: method === "cash" ? cashAmount : undefined,
      change: method === "cash" ? change : undefined,
      at: new Date(),
    });
  };

  const {
    stk,
    busy: stkBusy,
    error: stkError,
    request,
    reset: resetStk,
  } = useStkPush((checkoutRequestId, receipt) => void sell(checkoutRequestId, receipt));

  const shownError = error ?? stkError;

  return (
    <Modal title={`Take payment — ${money(total)}`} onClose={onClose}>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {METHODS.map((m) => (
          <button
            key={m.key}
            aria-pressed={method === m.key}
            onClick={() => {
              setMethod(m.key);
              setCashReceived("");
              setError(null);
              resetStk();
            }}
            className={cn(
              "min-h-11 rounded-xl border py-2 text-sm font-medium transition-colors",
              method === m.key
                ? "border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 ring-1 ring-teal-600/30"
                : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {method === "cash" && (
        <div className="space-y-3">
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
              autoFocus
            />
          </Field>
          <div className="flex justify-between text-sm">
            <span>Change due</span>
            <strong className="tabular-nums text-teal-700 dark:text-teal-400">{money(change)}</strong>
          </div>
        </div>
      )}

      {method === "mpesa" && stkFlow && (
        <Field label="Customer phone (Safaricom)">
          <input
            className={inputClass}
            placeholder="e.g. 0712 345678"
            value={phone}
            disabled={stk?.status === "pending"}
            onChange={(e) => setPhone(e.target.value)}
            autoFocus
          />
        </Field>
      )}

      {needsReference && (
        <Field label={method === "mpesa" ? "M-Pesa code" : "Card reference"}>
          <input
            className={inputClass}
            placeholder={method === "mpesa" ? "e.g. SGH4X2K9QT" : ""}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            autoFocus
          />
        </Field>
      )}

      {shownError && (
        <p className="mt-3 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">{shownError}</p>
      )}

      {stkFlow && stk && (
        <StkBanner
          stk={stk}
          phone={phone}
          onReset={resetStk}
          success={
            error ? (
              <>
                the sale was not recorded.{" "}
                <button
                  className="underline"
                  disabled={busy}
                  onClick={() => void sell(stk.id, stk.receipt ?? stk.id)}
                >
                  Retry recording the sale
                </button>
              </>
            ) : (
              "recording the sale…"
            )
          }
        />
      )}

      {stkFlow ? (
        <Button
          className="mt-4 w-full"
          disabled={busy || stkBusy || !phone.trim() || stk?.status === "pending" || stk?.status === "success"}
          onClick={() =>
            void request({
              phone,
              accountReference: "AmlaMedicare",
              items,
              walkIn: prescription ?? {},
            })
          }
        >
          {!phone.trim()
            ? "Enter the customer's phone number"
            : stk?.status === "pending"
              ? "Waiting for M-Pesa…"
              : `Request ${money(Math.max(1, Math.round(total)))} via M-Pesa`}
        </Button>
      ) : (
        <Button
          className="mt-4 w-full"
          disabled={busy || !cashValid || (needsReference && !reference.trim())}
          onClick={() => void sell()}
        >
          {busy
            ? "Recording…"
            : method === "cash" && !cashReceived.trim()
              ? "Enter cash received"
              : method === "cash" && !cashValid
                ? "Cash received is not enough"
                : needsReference && !reference.trim()
                  ? "Enter the payment reference"
                  : method === "cash" && change > 0
                    ? `Complete sale · return ${money(change)}`
                    : "Complete sale"}
        </Button>
      )}
    </Modal>
  );
}

// Kenyan notes and coins, largest first — the drawer is counted in these.
const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1];

/** Open the till with a float, or close it against a counted drawer. */
function TillModal({ shift, onClose }: { shift: Shift | null; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Shift | null>(null);

  const counted = DENOMINATIONS.reduce((s, d) => s + d * (Number(counts[d]) || 0), 0);

  const submit = async () => {
    setBusy(true);
    setError(null);
    if (shift) {
      const breakdown = DENOMINATIONS.filter((d) => Number(counts[d]) > 0)
        .map((d) => `${d}×${counts[d]}`)
        .join(", ");
      const res = await closeShift(
        counted,
        [notes, breakdown && `Count: ${breakdown}`].filter(Boolean).join(" | "),
      );
      setBusy(false);
      if ("error" in res) {
        setError(res.error ?? "Could not close the till.");
        return;
      }
      setResult(res.shift);
      return;
    }
    const err = await openShift(Number(amount), notes);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  if (result) {
    const balanced = Math.abs(result.cashShortageOverage ?? 0) < 0.01;
    return (
      <Modal title="Till closed — reconciliation" onClose={onClose}>
        <dl className="space-y-1 text-sm">
          <Row label="Expected in drawer" value={money(result.expectedClosingCash ?? 0)} />
          <Row label="Counted" value={money(result.closingCashCounted ?? 0)} />
          <Row
            label={
              balanced
                ? "Cash balanced ✓"
                : (result.cashShortageOverage ?? 0) > 0
                  ? "Overage"
                  : "Shortage"
            }
            value={balanced ? "" : money(Math.abs(result.cashShortageOverage ?? 0))}
            className={balanced ? "text-teal-700 dark:text-teal-400 font-semibold" : "text-rose-700 dark:text-rose-400 font-semibold"}
          />
          <div className="border-t border-border pt-2" />
          <Row label="M-Pesa recorded on sales" value={money(result.totalMpesaSales)} />
          <Row label="Card" value={money(result.totalCardSales)} />
          {result.status === "discrepancy" && (
            <p className="mt-2 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              This till was flagged with a discrepancy. A manager can review it under
              Reconciliation.
            </p>
          )}
        </dl>
        <Button className="mt-4 w-full" onClick={onClose}>
          Done
        </Button>
      </Modal>
    );
  }

  return (
    <Modal title={shift ? "Close till" : "Open till"} onClose={onClose}>
      {error && <p className="mb-3 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {shift ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Cash sales this session: <strong className="text-foreground">{money(shift.totalCashSales)}</strong> · opening float{" "}
            <strong className="text-foreground">{money(shift.openingCash)}</strong>
          </p>
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">
              Count the cash in the drawer
            </label>
            <div className="grid grid-cols-3 gap-2">
              {DENOMINATIONS.map((d) => (
                <div key={d} className="flex items-center gap-1.5">
                  <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">{d} ×</span>
                  <input
                    type="number"
                    min="0"
                    className={`${inputClass} !py-1.5 text-center`}
                    placeholder="0"
                    aria-label={`Number of ${d} shilling notes`}
                    value={counts[d] ?? ""}
                    onChange={(e) => setCounts({ ...counts, [d]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-sm font-bold">
              <span>Counted total</span>
              <span className="tabular-nums">{money(counted)}</span>
            </div>
          </div>
        </div>
      ) : (
        <Field label="Opening cash float (KSh)">
          <input
            className={inputClass}
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </Field>
      )}
      <Field label="Notes (optional)">
        <textarea
          className={inputClass}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <Button className="mt-2 w-full" disabled={busy} onClick={submit}>
        {busy ? "Saving…" : shift ? "Close till" : "Open till"}
      </Button>
    </Modal>
  );
}

function Row({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`flex justify-between ${className}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
