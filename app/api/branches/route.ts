// Clinic branches.
//   GET   /api/branches            → every branch (any signed-in user)
//   POST  /api/branches            → create a branch (admins)
//   PATCH /api/branches            → edit / open / close / make main (admins)
//   PUT   /api/branches            → { branchId | "all" } — the branch an admin
//                                    is looking at (stored in a cookie)

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/roles";
import {
  ALL_BRANCHES,
  BRANCH_COOKIE,
  createBranch,
  listBranches,
  updateBranch,
} from "@/lib/server/branches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function adminSession() {
  const session = await getSession();
  return session && hasPermission(session.role, "clinic.mutate.all") ? session : null;
}

export async function GET() {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ branches: await listBranches() });
}

export async function POST(req: Request) {
  if (!(await adminSession())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await createBranch(await req.json());
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ branches: await listBranches() });
}

export async function PATCH(req: Request) {
  if (!(await adminSession())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await updateBranch(await req.json());
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ branches: await listBranches() });
}

export async function PUT(req: Request) {
  // Admins (and the developer, read-only) switch; everyone else always works
  // in their own branch.
  const session = await getSession();
  if (!session || (session.role !== "developer" && !hasPermission(session.role, "clinic.mutate.all"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { branchId } = (await req.json()) as { branchId?: string };
  const branches = await listBranches();
  const value =
    branchId === ALL_BRANCHES
      ? ALL_BRANCHES
      : branches.find((b) => b.id === branchId && b.active)?.id;
  if (!value) return NextResponse.json({ error: "Unknown branch." }, { status: 400 });
  (await cookies()).set(BRANCH_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return NextResponse.json({ ok: true });
}
