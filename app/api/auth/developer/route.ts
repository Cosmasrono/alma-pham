// Developer access, used only by the unlinked /dev-access page.
//   GET                                              → { signupOpen }
//   POST { action: "signup", name, email, password } → emails a 6-digit code
//   POST { action: "verify", email, code }           → creates the account, signs in
//   POST { action: "login", email, password }        → signs in
// The first signup (any email) becomes the developer; then signup closes except
// for emails in DEVELOPER_EMAIL. Every session is view-only.
import { NextResponse } from "next/server";
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/jwt";
import type { SessionUser } from "@/lib/auth/roles";
import { developerAccountLogin, developerSignupOpen, startDeveloperSignup, verifyDeveloperSignup } from "@/lib/server/developer";
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

  if (body.action === "login") {
    const session = await developerAccountLogin(body.email, body.password);
    if (!session) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    return withSession(session);
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
