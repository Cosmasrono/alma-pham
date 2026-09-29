"use client";

import { useEffect, useState } from "react";
import { AuthCard } from "@/components/AuthCard";
import { Button, Field, Spinner, inputClass } from "@/components/ui";
import { homeForRole, type Role } from "@/lib/auth/roles";
import { notify } from "@/lib/toast";

type Mode = "loading" | "login" | "setup";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("loading");

  // Until the one admin has signed up, show the admin sign-up form instead.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/bootstrap");
        const { needsSetup } = await res.json();
        if (alive) setMode(needsSetup ? "setup" : "login");
      } catch {
        if (alive) setMode("login");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <AuthCard>
      {mode === "loading" && (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400">
          <Spinner /> Loading…
        </p>
      )}
      {mode === "setup" && <SetupForm />}
      {mode === "login" && <LoginForm />}
    </AuthCard>
  );
}

function LoginForm() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const message = body.error ?? "Login failed";
        setError(message);
        notify("error", message);
        setBusy(false);
        return;
      }
      notify("success", "Signed in successfully.");
      const { user } = (await res.json()) as { user: { role: Role } };
      const params = new URLSearchParams(window.location.search);
      window.location.href = params.get("next") || homeForRole(user.role);
    } catch {
      setError("Network error");
      notify("error", "Network error. Please try again.");
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="mb-1 font-display text-xl font-semibold text-teal-950">
        Sign in
      </h1>
      <p className="mb-5 text-sm text-zinc-500">
        Enter the username or email and password your administrator gave you.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Email or username">
          <input
            className={inputClass}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoFocus
            autoComplete="username"
            required
          />
        </Field>
        <Field label="Password">
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <a
          href="/forgot-password"
          className="-mt-2 self-end text-xs font-medium text-teal-700 hover:underline"
        >
          Forgot password?
        </a>
        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {busy && <Spinner />}
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </>
  );
}

function SetupForm() {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // Set once the code has been emailed: the form then asks for the code.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (message: string) => {
    setError(message);
    notify("error", message);
    setBusy(false);
  };

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (password !== confirm) return fail("The passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, email, password }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; email?: string };
      if (!res.ok) return fail(body.error ?? "Sign-up failed");
      setSentTo(body.email ?? email);
      setCode("");
      notify("success", "Verification code sent. Check your email.");
      setBusy(false);
    } catch {
      fail("Network error. Please try again.");
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/bootstrap/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: sentTo, code }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        return fail(body.error ?? "Verification failed");
      }
      notify("success", "Email verified. Admin account created.");
      window.location.href = homeForRole("admin");
    } catch {
      fail("Network error. Please try again.");
    }
  };

  const errorBox = error && (
    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
  );

  if (sentTo) {
    return (
      <>
        <h1 className="mb-1 font-display text-xl font-semibold text-teal-950">
          Verify your email
        </h1>
        <p className="mb-5 text-sm text-zinc-500">
          We sent a 6-digit code to <strong className="text-zinc-700">{sentTo}</strong>.
          Enter it below to finish creating the admin account. It expires in 15 minutes.
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
            {busy ? "Verifying…" : "Verify & create admin"}
          </Button>
          <div className="flex justify-between text-xs font-medium text-teal-700">
            <button type="button" className="hover:underline" onClick={() => { setSentTo(null); setError(null); }}>
              ← Change details
            </button>
            <button type="button" className="hover:underline disabled:opacity-50" disabled={busy} onClick={() => sendCode()}>
              Resend code
            </button>
          </div>
        </form>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 font-display text-xl font-semibold text-teal-950">
        Admin sign up
      </h1>
      <p className="mb-5 text-sm text-zinc-500">
        Create the administrator account. There is only one admin, and it adds
        every other staff member. We&apos;ll email you a code to confirm the address.
      </p>
      <form onSubmit={sendCode} className="flex flex-col gap-4">
        <Field label="Your full name">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
        </Field>
        <Field label="Choose a username">
          <input
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. admin"
            autoComplete="username"
            required
          />
        </Field>
        <Field label="Your email address">
          <input
            className={inputClass}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@clinic.example"
            autoComplete="email"
            required
          />
        </Field>
        <Field label="Choose a password">
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        <Field label="Confirm password">
          <input
            className={inputClass}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        {errorBox}
        <Button type="submit" disabled={busy} className="w-full">
          {busy && <Spinner />}
          {busy ? "Sending code…" : "Send verification code"}
        </Button>
      </form>
    </>
  );
}
