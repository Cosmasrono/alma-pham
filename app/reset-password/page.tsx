"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { Button, Field, Spinner, inputClass } from "@/components/ui";
import { notify } from "@/lib/toast";

export default function ResetPasswordPage() {
  return (
    <AuthCard>
      {/* useSearchParams needs a Suspense boundary during prerender. */}
      <Suspense
        fallback={
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400">
            <Spinner /> Loading…
          </p>
        }
      >
        <ResetForm />
      </Suspense>
    </AuthCard>
  );
}

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <>
        <h1 className="mb-1 font-display text-xl font-semibold text-teal-950">
          Invalid reset link
        </h1>
        <p className="mb-5 text-sm text-zinc-500">
          This link is missing its reset code. Request a new one and use the
          link from the email without editing it.
        </p>
        <a
          href="/forgot-password"
          className="text-sm font-medium text-teal-700 hover:underline"
        >
          Request a new link
        </a>
      </>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const message = body.error ?? "Password reset failed.";
        setError(message);
        notify("error", message);
        setBusy(false);
        return;
      }
      notify("success", "Password updated. Sign in with your new password.");
      window.location.href = "/login";
    } catch {
      setError("Network error. Please try again.");
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="mb-1 font-display text-xl font-semibold text-teal-950">
        Choose a new password
      </h1>
      <p className="mb-5 text-sm text-zinc-500">
        Pick a new password for your account. You&apos;ll sign in with it right
        after.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="New password">
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="new-password"
            minLength={6}
            required
          />
        </Field>
        <Field label="Confirm new password">
          <input
            className={inputClass}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={6}
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
          {busy ? "Saving…" : "Set new password"}
        </Button>
      </form>
    </>
  );
}
