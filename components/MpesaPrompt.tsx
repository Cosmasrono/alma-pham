"use client";

// The "prompt the customer's phone" M-Pesa flow, shared by every till in the
// clinic. Reception (per-stage gates) and the pharmacy POS (pay-at-end) run
// the same push → poll → settle sequence, so a patient sees the same PIN
// prompt whether they pay stage by stage or all at once.

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { notify } from "@/lib/toast";

/** One STK push being watched from a till. `id` is the CheckoutRequestID the
 *  server minted — it is what checkout / payCharges must be handed as their
 *  reference, so money can only be booked against a push we saw succeed. */
export interface StkState {
  id: string;
  status: "pending" | "success" | "failed";
  startedAt: number; // when the push was requested, for the polling backstop
  receipt?: string;
  detail?: string;
}

/** What the till is asking for. The server prices it from the catalog and the
 *  visit's own charges — amounts are never taken from the client. */
export interface StkRequest {
  phone: string;
  accountReference?: string;
  visitId?: string;
  /** Restricts the bill to these charges — reception's gate settles only the
   *  lines it is holding the patient for. Omit to include everything unpaid. */
  chargeIds?: string[];
  items?: { medicineId: string; quantity: number }[];
  /** Walk-in counter sale: the outside prescription behind any
   *  prescription-only item, checked before the customer is charged. */
  walkIn?: { prescriber?: string; prescriberFacility?: string };
}

// The server settles stale pushes after 2 minutes; this backstop only fires
// if the status endpoint itself is unreachable and keeps reporting pending.
const STK_CLIENT_TIMEOUT_MS = 3 * 60_000;

/** Are PayHero credentials configured? If not, M-Pesa falls back to typing the
 *  code off the customer's phone. */
export function useStkEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/mpesa/stkpush")
      .then((r) => r.json())
      .then((b: { configured?: boolean }) => {
        if (!cancelled) setEnabled(!!b.configured);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}

/** Pops the PIN prompt on the customer's phone and polls until M-Pesa settles
 *  it. `onConfirmed` fires once the money is actually in — that is where the
 *  till books the payment, with the CheckoutRequestID as its reference. */
export function useStkPush(
  onConfirmed: (checkoutRequestId: string, receipt: string) => void,
) {
  const [stk, setStk] = useState<StkState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kept in a ref so the poller always calls the latest closure (fresh cart,
  // fresh charges) without restarting the poll on every render.
  const confirmed = useRef(onConfirmed);
  useEffect(() => {
    confirmed.current = onConfirmed;
  });

  const request = useCallback(async (payload: StkRequest) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/mpesa/stkpush", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as {
        checkoutRequestId?: string;
        reused?: boolean;
        error?: string;
      };
      if (!res.ok || !body.checkoutRequestId) {
        const message = body.error ?? "M-Pesa request failed.";
        setError(message);
        notify("error", message);
        return;
      }
      setStk({
        id: body.checkoutRequestId,
        status: "pending",
        startedAt: Date.now(),
      });
      notify(
        "success",
        body.reused
          ? "This amount was already paid from that phone — reusing the payment."
          : "M-Pesa request sent.",
      );
    } catch {
      const message = "M-Pesa request failed — check your connection.";
      setError(message);
      notify("error", message);
    } finally {
      setBusy(false);
    }
  }, []);

  /** Back to a clean till: drops the tracked push and any error with it. */
  const reset = useCallback(() => {
    setStk(null);
    setError(null);
  }, []);

  // While the push is pending, poll until M-Pesa settles it.
  useEffect(() => {
    if (!stk || stk.status !== "pending") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (Date.now() - stk.startedAt > STK_CLIENT_TIMEOUT_MS) {
        setStk({ ...stk, status: "failed", detail: "no response from M-Pesa" });
        notify("error", "M-Pesa confirmation timed out.");
        return;
      }
      try {
        const res = await fetch(`/api/mpesa/status?id=${stk.id}`);
        const body = (await res.json()) as {
          status?: string;
          receipt?: string;
          detail?: string;
        };
        if (cancelled) return;
        if (body.status === "success" || body.status === "failed") {
          setStk({
            ...stk,
            status: body.status,
            receipt: body.receipt,
            detail: body.detail,
          });
          if (body.status === "success") {
            notify("success", "Payment confirmed. Money received on M-Pesa.");
            confirmed.current(stk.id, body.receipt ?? stk.id);
          } else {
            notify(
              "error",
              body.detail ??
                "Payment failed or not confirmed. No money was received.",
            );
          }
          return;
        }
      } catch {
        // transient — keep polling
      }
      if (!cancelled) timer = setTimeout(tick, 3000);
    };
    timer = setTimeout(tick, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stk]);

  return { stk, busy, error, request, reset };
}

/** What the cashier sees while the customer's phone is ringing. `success` is
 *  whatever the till does next — closing the visit, releasing the gate. */
export function StkBanner({
  stk,
  phone,
  onReset,
  success,
}: {
  stk: StkState;
  phone: string;
  onReset: () => void;
  success: ReactNode;
}) {
  if (stk.status === "pending") {
    return (
      <div className="mt-3 flex items-center justify-between rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-300">
        <span className="animate-pulse">
          Request sent to {phone} — waiting for the customer to enter their
          M-Pesa PIN…
        </span>
        <Button size="sm" variant="ghost" onClick={onReset}>
          Cancel
        </Button>
      </div>
    );
  }
  if (stk.status === "success") {
    return (
      <p className="mt-3 rounded-lg border border-teal-200 dark:border-teal-900/50 bg-teal-50 dark:bg-teal-950/40 p-3 text-sm text-teal-800 dark:text-teal-300">
        Payment confirmed and money received
        {stk.receipt ? ` (${stk.receipt})` : ""} — {success}
      </p>
    );
  }
  return (
    <p className="mt-3 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
      Payment failed or not confirmed: {stk.detail ?? "no money received"}.{" "}
      <button className="underline" onClick={onReset}>
        Try again
      </button>
    </p>
  );
}
