"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, inputClass } from "@/components/ui";
import { useSession } from "@/components/SessionProvider";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

function useIdleLock(enabled: boolean) {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastActivity = Date.now();

    const reset = () => {
      lastActivity = Date.now();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setLocked(true), IDLE_TIMEOUT_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
          setLocked(true);
          return;
        }
      }
      reset();
    };

    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
    ];

    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);

    reset();

    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, reset));
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);

  return { locked, setLocked };
}

export function SessionLockGate() {
  const session = useSession();
  const { locked, setLocked } = useIdleLock(Boolean(session));

  const [pin, setPin] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [needsPinSetup, setNeedsPinSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resetForm = () => {
    setPin("");
    setCurrentPassword("");
    setNewPin("");
    setConfirmPin("");
    setNeedsPinSetup(false);
    setError(null);
    setBusy(false);
  };

  const hiddenPin = useMemo(() => "•".repeat(pin.length), [pin]);

  // The developer account has no PIN (it isn't a clinic user): an idle
  // developer session on a clinic computer is simply signed out.
  const idleDeveloper = Boolean(session && locked && session.role === "developer");
  useEffect(() => {
    if (!idleDeveloper) return;
    void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
      window.location.href = "/login";
    });
  }, [idleDeveloper]);

  if (!session || !locked || idleDeveloper) return null;

  const unlockWithPin = async () => {
    if (!/^\d{4}$/.test(pin)) {
      setError("Enter your 4-digit PIN.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "verify", pin }),
      });

      if (res.ok) {
        resetForm();
        setLocked(false);
        return;
      }

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };

      if (res.status === 428 || body.code === "PIN_NOT_SET") {
        setNeedsPinSetup(true);
        setError("Set your 4-digit PIN to use quick unlock.");
      } else {
        setError(body.error ?? "PIN verification failed.");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const savePin = async () => {
    if (!/^\d{4}$/.test(newPin)) {
      setError("PIN must be exactly 4 digits.");
      return;
    }
    if (newPin !== confirmPin) {
      setError("PINs do not match.");
      return;
    }
    if (!currentPassword) {
      setError("Enter your current password to confirm.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "set",
          pin: newPin,
          currentPassword,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not save PIN.");
        return;
      }

      resetForm();
      setLocked(false);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-100 grid place-items-center bg-teal-950/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-white/20 bg-white p-6 shadow-2xl">
        <h2 className="font-display text-2xl font-semibold text-teal-950">Session locked</h2>
        <p className="mt-1 text-sm text-zinc-500">
          For security, enter your 4-digit PIN to continue.
        </p>

        {!needsPinSetup ? (
          <div className="mt-5 space-y-3">
            <input
              className={`${inputClass} text-center text-2xl tracking-[0.6em]`}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              placeholder="••••"
              aria-label="4 digit PIN"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void unlockWithPin();
              }}
            />
            <p className="text-center text-xs text-zinc-400">{hiddenPin || "Enter 4 digits"}</p>
            {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
            <Button className="w-full" onClick={unlockWithPin} disabled={busy}>
              {busy ? "Unlocking..." : "Unlock"}
            </Button>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <input
              className={inputClass}
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              autoFocus
              autoComplete="current-password"
            />
            <input
              className={`${inputClass} text-center text-xl tracking-[0.5em]`}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              placeholder="New PIN"
            />
            <input
              className={`${inputClass} text-center text-xl tracking-[0.5em]`}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              placeholder="Confirm PIN"
              onKeyDown={(e) => {
                if (e.key === "Enter") void savePin();
              }}
            />
            {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
            <Button className="w-full" onClick={savePin} disabled={busy}>
              {busy ? "Saving..." : "Save PIN and unlock"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
