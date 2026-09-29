// The developer console (the software vendor's support account).
//   GET  /api/developer → the whole system at a glance
//   POST /api/developer → { action, ... } — on/off switches only:
//        the whole system, a branch, a branch's staff, or one account.
// Nothing here edits clinic data: no sales, stock, prices, patients or
// settings — the proxy refuses every other write from this account.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { computeBranchOverview } from "@/lib/server/branch-stats";
import { updateBranch } from "@/lib/server/branches";
import { mpesaConfigured } from "@/lib/server/mpesa";
import { mailConfigured } from "@/lib/server/mail";
import { lockMessageFor, setSystemLock, systemLock } from "@/lib/server/developer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

async function developerOnly() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "developer") {
    return NextResponse.json({ error: "Only the developer account can do this." }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await developerOnly();
  if (denied) return denied;

  const now = Date.now();
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();

  const [overview, today, users, patients, lock] = await Promise.all([
    // Last 30 days per branch (with the 30 days before, for the change).
    computeBranchOverview(now - 30 * DAY_MS, now),
    computeBranchOverview(startOfToday, now),
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, username: true, email: true, role: true, active: true, branchId: true },
    }),
    prisma.patient.count({ where: { mrn: { startsWith: "P-" } } }),
    systemLock(),
  ]);

  const byRole: Record<string, number> = {};
  for (const u of users) if (u.active) byRole[u.role] = (byRole[u.role] ?? 0) + 1;
  const todayById = new Map(today.stats.map((s) => [s.branchId, s]));
  const total = (pick: (s: (typeof overview.stats)[number]) => number) =>
    overview.stats.reduce((sum, s) => sum + pick(s), 0);

  return NextResponse.json({
    system: {
      locked: lock.locked,
      message: lock.locked ? lockMessageFor(lock) : null,
      rawMessage: lock.message,
    },
    integrations: {
      database: true, // this response came from it
      mpesa: mpesaConfigured(),
      ai: Boolean(process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY),
      email: mailConfigured(),
    },
    totals: {
      branches: overview.branches.length,
      activeBranches: overview.branches.filter((b) => b.active).length,
      staff: users.length,
      activeStaff: users.filter((u) => u.active).length,
      admins: users.filter((u) => u.role === "admin" && u.active).length,
      patients,
      revenueToday: today.stats.reduce((s, x) => s + x.revenue, 0),
      revenue30: total((s) => s.revenue),
      revenuePrev30: total((s) => s.previousRevenue),
      inHouse30: total((s) => s.inHouseRevenue),
      community30: total((s) => s.communityRevenue),
      visits30: total((s) => s.visits),
      openNow: total((s) => s.openNow),
      stockValue: total((s) => s.stock.valueRetail),
      openTills: total((s) => s.tills.open),
    },
    staffByRole: Object.entries(byRole).map(([role, count]) => ({
      role,
      label: ROLE_LABELS[role as Role] ?? role,
      count,
    })),
    branches: overview.branches.map((b) => ({
      ...b,
      stats: overview.stats.find((x) => x.branchId === b.id) ?? null,
      revenueToday: todayById.get(b.id)?.revenue ?? 0,
      assigned: users.filter((u) => u.branchId === b.id).length,
      assignedActive: users.filter((u) => u.branchId === b.id && u.active).length,
    })),
    users,
  });
}

type Action =
  | { action: "setSystemLock"; locked: boolean; message?: string }
  | { action: "setBranchActive"; branchId: string; active: boolean }
  | { action: "setBranchStaffActive"; branchId: string; active: boolean }
  | { action: "setUserActive"; userId: string; active: boolean };

export async function POST(req: Request) {
  const denied = await developerOnly();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Action;

  switch (body.action) {
    case "setSystemLock":
      await setSystemLock(body.locked === true, body.message ?? null);
      return NextResponse.json({ ok: true });

    case "setBranchActive": {
      const r = await updateBranch({ id: body.branchId, active: body.active === true });
      if ("error" in r) return NextResponse.json(r, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case "setBranchStaffActive": {
      const r = await prisma.user.updateMany({
        where: { branchId: body.branchId },
        data: { active: body.active === true },
      });
      return NextResponse.json({ ok: true, changed: r.count });
    }

    case "setUserActive": {
      const u = await prisma.user.findUnique({ where: { id: body.userId } });
      if (!u) return NextResponse.json({ error: "User not found." }, { status: 404 });
      await prisma.user.update({ where: { id: u.id }, data: { active: body.active === true } });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "Only on/off switches are available here." }, { status: 400 });
  }
}
