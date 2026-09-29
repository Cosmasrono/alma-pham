"use client";

import { useEffect, useState } from "react";
import { TOAST_EVENT, type ToastPayload } from "@/lib/toast";
import { cn } from "./ui";

type Toast = ToastPayload & {
  id: number;
};

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function onToast(event: Event) {
      const detail = (event as CustomEvent<ToastPayload>).detail;
      if (!detail?.message) return;
      const id = Date.now() + Math.random();
      setToasts((items) => [...items, { ...detail, id }].slice(-3));
      window.setTimeout(() => {
        setToasts((items) => items.filter((item) => item.id !== id));
      }, 4200);
    }

    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cn(
            "flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg shadow-teal-950/10 backdrop-blur",
            toast.kind === "success"
              ? "border-teal-200 bg-teal-50/95 text-teal-900"
              : "border-red-200 bg-red-50/95 text-red-800",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "mt-1 h-2 w-2 shrink-0 rounded-full",
              toast.kind === "success" ? "bg-teal-600" : "bg-red-500",
            )}
          />
          {toast.message}
        </div>
      ))}
    </div>
  );
}
