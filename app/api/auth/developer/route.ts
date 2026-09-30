// Developer signup, used by /dev-access ("Are you a developer?" on the sign-in
// page). Only one developer account may ever exist; after that, signup closes
// and the developer signs in on the normal sign-in page.
//   GET                                              → { signupOpen }
//   POST { action: "signup", name, email, password } → emails a 6-digit code
//   POST { action: "verify", email, code }           → creates the account, signs in
import { NextResponse } from "next/server";
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/jwt";
import type { SessionUser } from "@/lib/auth/roles";
import { developerSignupOpen, startDeveloperSignup, verifyDeveloperSignup } from "@/lib/server/developer";
import { mailConfigured, sendAdminSignupCodeEmail } from "@/lib/server/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ signupOpen: await developerSignupOpen() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  if (body.action === "signup") {
    if (!mailConfigured()) {
      return NextResponse.json({ error: "Email is not configured on the server, so a verification code can't be sent." }, { status: 503 });
    }
    const result = await startDeveloperSignup(body);
    if ("error" in result) return NextResponse.json(result, { status: 409 });
    try {
      await sendAdminSignupCodeEmail({ to: result.email, name: result.name, code: result.code, account: "developer" });
    } catch (err) {
      console.error("developer signup code email failed", err);
      return NextResponse.json({ error: "We couldn't send the verification email. Try again." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, email: result.email });
  }

  if (body.action === "verify") {
    const result = await verifyDeveloperSignup(body.email, body.code);
    if ("error" in result) return NextResponse.json(result, { status: 400 });
    return withSession(result.session);
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

async function withSession(user: SessionUser) {
  const res = NextResponse.json({ ok: true, user: { name: user.name, role: user.role } });
  res.cookies.set(SESSION_COOKIE, await signSession(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
