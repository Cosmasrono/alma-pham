// Second step of the admin sign-up: check the emailed code, create the admin
// and log them straight in.
import { NextResponse } from "next/server";
import * as repo from "@/lib/server/clinic-repo";
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/jwt";
import type { Role } from "@/lib/auth/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  const result = await repo.verifyAdminSignup(String(body.email ?? ""), String(body.code ?? ""));
  if ("error" in result) {
    return NextResponse.json(result, { status: 400 });
  }
  const u = result.user;
  const token = await signSession({
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role as Role,
  });
  const res = NextResponse.json({ ok: true, user: { name: u.name, role: u.role } });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
