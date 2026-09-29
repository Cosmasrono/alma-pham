// Admin-only user management. Middleware already restricts /api/users to the
// admin role; we re-check here as defense in depth.
import { NextResponse } from "next/server";
import * as repo from "@/lib/server/clinic-repo";
import { getSession } from "@/lib/auth/session";
import { canView, hasPermission } from "@/lib/auth/roles";
import { mailConfigured, sendAccountSetupEmail } from "@/lib/server/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SUPER_ADMIN_EMAIL = "ccosmas001@gmail.com";

async function ensureCanManageUsers() {
  const session = await getSession();
  return session && hasPermission(session.role, "users.manage") ? session : null;
}

async function isSuperAdminSession(userId: string): Promise<boolean> {
  const user = await repo.getUserById(userId);
  return user?.email?.toLowerCase() === SUPER_ADMIN_EMAIL;
}

export async function GET() {
  // Admins manage users; the developer may look (its writes are refused).
  const session = await getSession();
  if (!session || !canView(session.role, "users.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ users: await repo.listUsers() });
}

export async function POST(req: Request) {
  if (!(await ensureCanManageUsers())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!mailConfigured()) {
    return NextResponse.json({ error: "Configure outgoing email before inviting staff." }, { status: 503 });
  }
  const body = await req.json();
  const result = await repo.createUser(body);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  let warning: string | undefined;
  try {
    await sendSetupLink(result.user, req);
  } catch {
    warning = "Account created, but the invitation could not be sent. Use Send setup link to retry.";
  }
  return NextResponse.json({ users: await repo.listUsers(), warning });
}

async function sendSetupLink(user: { email: string | null; name: string; username: string }, req: Request) {
  if (!user.email) throw new Error("User has no email address.");
  const reset = await repo.createPasswordReset(user.email, repo.SETUP_TTL_MS);
  if (!reset) throw new Error("Could not create a setup link.");
  const link = new URL(`/reset-password?mode=setup&token=${reset.token}`, process.env.APP_URL ?? new URL(req.url).origin).toString();
  await sendAccountSetupEmail({ to: user.email, name: user.name, username: user.username, link });
}

export async function PATCH(req: Request) {
  if (!(await ensureCanManageUsers())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json();
  if (body.action === "send-setup-link") {
    if (!mailConfigured()) return NextResponse.json({ error: "Outgoing email is not configured." }, { status: 503 });
    if (typeof body.id !== "string" || !/^[a-f0-9]{24}$/i.test(body.id)) return NextResponse.json({ error: "Invalid user." }, { status: 400 });
    const user = await repo.getUserById(body.id);
    if (!user?.active || !user.email) return NextResponse.json({ error: "The user must be active and have an email address." }, { status: 400 });
    try {
      await sendSetupLink(user, req);
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: "Could not send the setup email. Please retry." }, { status: 502 });
    }
  }
  const result = await repo.updateUser(body);
  if ("error" in result) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json({ users: await repo.listUsers() });
}

export async function DELETE(req: Request) {
  const session = await ensureCanManageUsers();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(await isSuperAdminSession(session.id))) {
    return NextResponse.json(
      { error: "Only super admin can delete users." },
      { status: 403 },
    );
  }

  const { id } = await req.json();
  const user = await repo.getUserById(id);

  if (user?.email?.toLowerCase() === SUPER_ADMIN_EMAIL) {
    return NextResponse.json(
      { error: "This user cannot be deleted." },
      { status: 403 }
    );
  }

  const result = await repo.deleteUser(id);
  if ("error" in result) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json({ users: await repo.listUsers() });
}
