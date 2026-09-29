"use client";

// When the developer locks the system, every clinic account's screen is
// covered by the lock notice (their API calls are refused too). The
// developer account always sees a thin "view only" strip instead — and a
// reminder when the system is locked.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "./SessionProvider";

interface Status {
  locked: boolean;
  message: string | null;
  appliesToMe: boolean;
}

const POLL_MS = 60_000;

export function SystemLockGate() {
  const session = useSession();
  const pathname = usePathname();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const check = () =>
      fetch("/api/system/status", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<Status>) : null))
        .then((s) => !cancelled && s && setStatus(s))
        .catch(() => {});
    void check();
    const t = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [session]);

  if (!session || pathname === "/" || pathname === "/login") return null;

  if (session.role === "developer") {
    return (
      <div
        className={
          "fixed inset-x-0 top-0 z-90 px-4 py-1 text-center text-[11px] font-semibold print:hidden " +
          (status?.locked ? "bg-amber-500 text-amber-950" : "bg-sky-700 text-white")
        }
      >
        Developer access · view only — clinic data can&apos;t be changed from this account
        {status?.locked && " · SYSTEM LOCKED for all clinic staff (unlock in the Developer console)"}
      </div>
    );
  }

  if (!status?.locked || !status.appliesToMe) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="system-locked-title"
      className="fixed inset-0 z-100 grid place-items-center bg-teal-950/85 p-6 backdrop-blur-sm"
    >
      <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
        <p className="text-4xl" aria-hidden>
          🔒
        </p>
        <h2 id="system-locked-title" className="mt-2 font-display text-xl font-semibold text-teal-950">
          System unavailable
        </h2>
        <p className="mt-2 text-sm text-zinc-600">{status.message}</p>
        <button
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/login";
          }}
          className="mt-5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
