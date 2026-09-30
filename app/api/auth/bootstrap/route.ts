// Restricted owner/admin sign-up. GET tells the login screen whether any account
// exists yet; POST starts the sign-up and emails a 6-digit code. The account
// is only created once that code is entered (see ./verify).
import { NextResponse } from "next/server";
import * as repo from "@/lib/server/clinic-repo";
import { mailConfigured, sendAdminSignupCodeEmail } from "@/lib/server/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const count = await repo.userCount();
  return NextResponse.json({ needsSetup: count === 0 });
}

export async function POST(req: Request) {
  if (!mailConfigured()) {
    return NextResponse.json(
      { error: "Email is not configured on the server, so a verification code can't be sent." },
      { status: 503 },
    );
  }
  const body = await req.json();
  const result = await repo.startAdminSignup(body);
  if ("error" in result) {
    return NextResponse.json(result, { status: 409 });
  }
  try {
    await sendAdminSignupCodeEmail({ to: result.email, name: result.name, code: result.code });
  } catch (err) {
    console.error("signup code email failed", err);
    return NextResponse.json(
      { error: "We couldn't send the verification email. Check the address and try again." },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, email: result.email });
}
