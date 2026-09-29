// Admin-only user management. Middleware already restricts /api/users to the
// admin role; we re-check here as defense in depth.
import { NextResponse } from "next/server";
import * as repo from "@/lib/server/clinic-repo";
import { getSession } from "@/lib/auth/session";
import { canView, hasPermission } from "@/lib/auth/roles";
import { mailConfigured, sendCredentialsEmail } from "@/lib/server/mail";

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
  const body = await req.json();
  const result = await repo.createUser(body);
  if ("error" in result) {
    return NextResponse.json(result, { status: 400 });
  }

  // Email the new account its sign-in details. Failing to send must not undo
  // the account, so problems come back as a warning the admin can act on.
  let warning: string | undefined;
  if (result.user.email) {
    if (!mailConfigured()) {
      warning =
        "User was created, but email is not configured, so the sign-in details were not sent.";
    } else {
      try {
        // A setup token lets them pick their own password straight from the
        // email; the temporary password is the fallback if it lapses.
        const reset = await repo.createPasswordReset(
          result.user.email,
          repo.SETUP_TTL_MS,
        );
        const origin = process.env.APP_URL ?? new URL(req.url).origin;
        await sendCredentialsEmail({
          to: result.user.email,
          name: result.user.name,
          username: result.user.username,
          password: result.tempPassword,
          setupLink: new URL(
            reset
              ? `/reset-password?token=${reset.token}`
              : "/forgot-password",
            origin,
          ).toString(),
        });
      } catch (err) {
        console.error("credentials email failed", err);
        warning =
          "User was created, but we could not email the sign-in details.";
      }
    }
  }

  return NextResponse.json({ users: await repo.listUsers(), warning });
}

export async function PATCH(req: Request) {
  if (!(await ensureCanManageUsers())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json();
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
