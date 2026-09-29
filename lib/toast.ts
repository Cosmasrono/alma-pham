"use client";

export type ToastKind = "success" | "error";

export type ToastPayload = {
  kind: ToastKind;
  message: string;
};

export const TOAST_EVENT = "carepham:toast";

export function notify(kind: ToastKind, message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, {
    detail: { kind, message },
  }));
}
