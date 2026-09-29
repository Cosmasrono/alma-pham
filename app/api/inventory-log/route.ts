// The inventory audit trail.
//   GET /api/inventory-log?from=<ms>&to=<ms>&branch=<id|all>&type=<type>
//                         &flagged=1&q=<medicine>&limit=<n>
// Returns the matching events (newest first) and, per branch, how many units
// moved by each kind of change — the dashboard's branch activity chart.
// Admins (and the read-only developer) see every branch; pharmacists see
// their own branch only.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { canView } from "@/lib/auth/roles";
import { branchContext } from "@/lib/server/branches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = [
  "sale",
  "receive",
  "adjust",
  "write-off",
  "transfer-out",
  "transfer-in",
  "import",
  "opening",
  "price",
  "edit",
] as const;

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canView(session.role, "clinic.medicine.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const now = Date.now();
  const to = Number(url.searchParams.get("to")) || now;
  const from = Number(url.searchParams.get("from")) || to - 30 * 24 * 60 * 60 * 1000;
  const typeParam = url.searchParams.get("type");
  const type = TYPES.find((t) => t === typeParam);
  const flaggedOnly = url.searchParams.get("flagged") === "1";
  const q = url.searchParams.get("q")?.trim();
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));

  // Admins/developer: every branch unless one is asked for. Everyone else:
  // their own branch, whatever they ask for.
  const ctx = await branchContext(session);
  const requested = url.searchParams.get("branch");
  const branchId = ctx.canSwitch
    ? requested && requested !== "all"
      ? requested
      : null
    : ctx.writeBranchId;

  const inWindow = {
    createdAt: { gte: new Date(from), lt: new Date(to) },
    ...(branchId && { branchId }),
  };
  const where = {
    ...inWindow,
    ...(type && { type }),
    ...(flaggedOnly && { flagged: true }),
    ...(q && { medicineName: { contains: q, mode: "insensitive" as const } }),
  };

  const [events, totals, flaggedCount] = await Promise.all([
    prisma.inventoryEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
    // Units moved per branch per kind of change, for the chart and tiles.
    prisma.inventoryEvent.groupBy({
      by: ["branchId", "type"],
      where: inWindow,
      _sum: { quantity: true },
      _count: { _all: true },
    }),
    prisma.inventoryEvent.count({ where: { ...inWindow, flagged: true } }),
  ]);

  return NextResponse.json({
    from,
    to,
    branchId,
    flaggedCount,
    totals: totals.map((t) => ({
      branchId: t.branchId,
      type: t.type,
      units: t._sum.quantity ?? 0,
      count: t._count._all,
    })),
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      medicineId: e.medicineId,
      medicineName: e.medicineName,
      branchId: e.branchId,
      quantity: e.quantity,
      stockAfter: e.stockAfter,
      details: e.details,
      reference: e.reference,
      byName: e.byName,
      flagged: e.flagged,
      flagReason: e.flagReason,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}
