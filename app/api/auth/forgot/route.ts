// Step 1 of password reset: email a single-use link.
//
// Always answers { ok: true } — whether or not the email matched an account —
// so the endpoint can't be used to discover which emails are registered.
import { NextResponse } from "next/server";
import { createPasswordReset } from "@/lib/server/clinic-repo";
import { mailConfigured, sendPasswordResetEmail } from "@/lib/server/mail";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!mailConfigured()) {
      return NextResponse.json(
        { error: "Email is not configured on this server. Ask your administrator to reset your password." },
        { status: 503 },
      );
    }

    const reset = await createPasswordReset(String(email ?? ""));
    if (reset) {
      const link = new URL(
        `/reset-password?token=${reset.token}`,
        process.env.APP_URL ?? new URL(req.url).origin,
      ).toString();
      await sendPasswordResetEmail({ to: reset.to, name: reset.name, link });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("forgot-password failed", err);
    return NextResponse.json(
      { error: "Could not send the reset email. Try again shortly." },
      { status: 500 },
    );
  }
}
