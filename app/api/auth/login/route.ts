import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/jwt";
import type { Role } from "@/lib/auth/roles";
import { lockMessageFor, systemLock } from "@/lib/server/developer";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // Staff sign in with whichever they were given: the username an admin
    // created for them, or their email. `email` is still accepted so an older
    // cached copy of the login page keeps working.
    const identifier = String(body.identifier ?? body.email ?? "")
      .trim()
      .toLowerCase();
    const password = body.password;

    // Developer accounts sign in at the unlinked /dev-access page, not here.

    // Guarded: a blank identifier would otherwise match the email-less users
    // created by the seed script, whose `email` is null.
    const user = identifier
      ? await prisma.user.findFirst({
          where: { OR: [{ username: identifier }, { email: identifier }] },
        })
      : null;

    const ok =
      user &&
      user.active &&
      (await verifyPassword(String(password ?? ""), user.passwordHash));

    if (!ok || !user) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 },
      );
    }

    // While the developer has locked the system, no clinic account gets in.
    const lock = await systemLock();
    if (lock.locked) {
      return NextResponse.json({ error: lockMessageFor(lock) }, { status: 423 });
    }

    const token = await signSession({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role as Role,
    });
    return withSession(token, user.name, user.role);
  } catch (err) {
    console.error("login failed", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}

/** The success reply, carrying the session cookie. */
function withSession(token: string, name: string, role: string) {
  const res = NextResponse.json({ ok: true, user: { name, role } });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
