"use client";

import { useEffect, useState } from "react";
import { AuthCard } from "@/components/AuthCard";
import { Button, Field, Spinner, inputClass } from "@/components/ui";
import { homeForRole } from "@/lib/auth/roles";
import { notify } from "@/lib/toast";

type Mode = "login" | "signup" | "verify";

export function DevAccess() {
  const [mode, setMode] = useState<Mode>("login");
  // Signup is open until the first developer account exists.
  const [signupOpen, setSignupOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/developer")
      .then((r) => r.json())
      .then((b: { signupOpen?: boolean }) => {
        setSignupOpen(b.signupOpen === true);
        if (b.signupOpen) setMode("signup");
      })
      .catch(() => {});
  }, []);

  const fail = (message: string) => {
    setError(message);
    notify("error", message);
    setBusy(false);
  };

  const call = async (payload: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/developer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; email?: string };
      if (!res.ok) {
        fail(body.error ?? "Request failed");
        return null;
      }
      return body;
    } catch {
      fail("Network error. Please try again.");
      return null;
    }
  };

  const signedIn = () => {
    notify("success", "Signed in as developer (view only).");
    window.location.href = homeForRole("developer");
  };

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await call({ action: "login", email, password })) signedIn();
  };

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (password !== confirm) return fail("The passwords don't match.");
    const body = await call({ action: "signup", name, email, password });
    if (!body) return;
    setEmail(body.email ?? email);
    setCode("");
    setMode("verify");
    setBusy(false);
    notify("success", "Verification code sent. Check your email.");
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await call({ action: "verify", email, code })) signedIn();
  };

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const errorBox = error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>;

  return (
    <AuthCard>
      {mode === "login" && (
        <>
          <h1 className="mb-1 font-display text-xl font-semibold text-teal-950 dark:text-zinc-100">Developer sign in</h1>
          <p className="mb-5 text-sm text-zinc-500 dark:text-zinc-400">View-only access for system support.</p>
          <form onSubmit={login} className="flex flex-col gap-4">
            <Field label="Email">
              <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" required />
            </Field>
            <Field label="Password">
              <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </Field>
            {errorBox}
            <Button type="submit" disabled={busy} className="w-full">
              {busy && <Spinner />}
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </>
      )}

      {mode === "signup" && (
        <>
          <h1 className="mb-1 font-display text-xl font-semibold text-teal-950 dark:text-zinc-100">Developer sign up</h1>
          <p className="mb-5 text-sm text-zinc-500 dark:text-zinc-400">
            The first account created here becomes the developer account. We&apos;ll email you a code to confirm your address.
          </p>
          <form onSubmit={sendCode} className="flex flex-col gap-4">
            <Field label="Your full name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
            </Field>
            <Field label="Email">
              <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </Field>
            <Field label="Choose a password (12+ characters)">
              <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={12} required />
            </Field>
            <Field label="Confirm password">
              <input className={inputClass} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={12} required />
            </Field>
            {errorBox}
            <Button type="submit" disabled={busy} className="w-full">
              {busy && <Spinner />}
              {busy ? "Sending code…" : "Send verification code"}
            </Button>
          </form>
        </>
      )}

      {mode === "verify" && (
        <>
          <h1 className="mb-1 font-display text-xl font-semibold text-teal-950 dark:text-zinc-100">Verify your email</h1>
          <p className="mb-5 text-sm text-zinc-500 dark:text-zinc-400">
            We sent a 6-digit code to <strong className="text-zinc-700 dark:text-zinc-200">{email}</strong>. It expires in 15 minutes.
          </p>
          <form onSubmit={verify} className="flex flex-col gap-4">
            <Field label="Verification code">
              <input
                className={`${inputClass} text-center font-mono text-lg tracking-[0.5em]`}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                autoFocus
                required
              />
            </Field>
            {errorBox}
            <Button type="submit" disabled={busy || code.length !== 6} className="w-full">
              {busy && <Spinner />}
              {busy ? "Verifying…" : "Verify & create account"}
            </Button>
            <div className="flex justify-between text-xs font-medium text-teal-700">
              <button type="button" className="hover:underline" onClick={() => switchTo("signup")}>← Change details</button>
              <button type="button" className="hover:underline disabled:opacity-50" disabled={busy} onClick={() => sendCode()}>Resend code</button>
            </div>
          </form>
        </>
      )}

      {mode !== "verify" && (signupOpen || mode === "signup") && (
        <button type="button" className="mt-4 text-sm font-medium text-teal-700 hover:underline" onClick={() => switchTo(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "No developer account? Sign up" : "Already have an account? Sign in"}
        </button>
      )}
    </AuthCard>
  );
}
