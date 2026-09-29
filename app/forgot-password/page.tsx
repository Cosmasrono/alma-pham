"use client";

import { useState } from "react";
import { AuthCard } from "@/components/AuthCard";
import { Button, Field, Spinner, inputClass } from "@/components/ui";
import { notify } from "@/lib/toast";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const message = body.error ?? "Could not send the reset email.";
        setError(message);
        notify("error", message);
        setBusy(false);
        return;
      }
      setSent(true);
    } catch {
      setError("Network error. Please try again.");
      setBusy(false);
    }
  };

  return (
    <AuthCard>
      {sent ? (
        <>
          <h1 className="mb-1 font-display text-xl font-semibold text-teal-950">
            Check your email
          </h1>
          <p className="mb-5 text-sm text-zinc-500">
            If <span className="font-medium text-zinc-700">{email}</span>{" "}
            belongs to an Amla Medicare account, we&apos;ve sent it a reset link. The
            link expires in 30 minutes.
          </p>
          <a
            href="/login"
            className="text-sm font-medium text-teal-700 hover:underline"
          >
            ← Back to sign in
          </a>
        </>
      ) : (
        <>
          <h1 className="mb-1 font-display text-xl font-semibold text-teal-950">
            Forgot your password?
          </h1>
          <p className="mb-5 text-sm text-zinc-500">
            Enter the email on your staff account and we&apos;ll send you a
            link to choose a new password.
          </p>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Email">
              <input
                className={inputClass}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                autoComplete="email"
                required
              />
            </Field>
            {error && (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy && <Spinner />}
              {busy ? "Sending…" : "Send reset link"}
            </Button>
            <a
              href="/login"
              className="text-center text-xs font-medium text-teal-700 hover:underline"
            >
              ← Back to sign in
            </a>
          </form>
        </>
      )}
    </AuthCard>
  );
}
