// Every branch side by side for one period — shared by the admin dashboard's
// branch comparison and the owner console. Per branch: revenue (in-house vs
// community) and its trend, the change on the previous period, visits and
// time in clinic, patients in the building now, stock health, tills, staff.

import { prisma } from "@/lib/prisma";
import { ensureBranchSetup } from "@/lib/server/branches";
import { DAY_MS, bucketIndex, bucketUnitFor, buildBuckets } from "@/lib/analytics";

const DEFAULT_REORDER = 10;

export interface BranchStats {
  branchId: string;
  revenue: number;
  previousRevenue: number;
  inHouseRevenue: number;
  communityRevenue: number;
  payments: number;
  visits: number; // clinic visits checked in during the period
  completedVisits: number;
  avgVisitMs: number | null;
  walkInSales: number;
  openNow: number; // clinic patients in the building right now
  series: number[]; // revenue per bucket, aligned with `buckets`
  stock: {
    valueRetail: number;
    valueCost: number;
    lowStock: number; // carried, at or below reorder level
    outOfStock: number; // carried before, now at zero
    expiringUnits: number; // in date, expiring within 90 days
    expiredUnits: number; // blocked from sale
  };
  tills: { open: number; discrepancies: number; netShortage: number };
  staff: number;
}

export interface BranchOverview {
  from: number;
  to: number;
  buckets: { label: string; full: string }[];
  branches: { id: string; name: string; code: string; isMain: boolean; active: boolean }[];
  stats: BranchStats[];
}

/** `from` of 0 means "all time" — it starts at the first visit instead. */
export async function computeBranchOverview(fromMs: number, to: number): Promise<BranchOverview> {
  const now = Date.now();
  const mainId = await ensureBranchSetup();

  let from = fromMs;
  if (from === 0) {
    const first = await prisma.visit.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    from = first ? first.createdAt.getTime() : to - 30 * DAY_MS;
  }
  const span = to - from;
  const prevFrom = from - span;

  const [branches, visits, medicines, stockRows, batches, shifts, users] = await Promise.all([
    prisma.branch.findMany({ orderBy: [{ isMain: "desc" }, { name: "asc" }] }),
    // Anything paid, checked in or still open in the two windows. A payment
    // updates its visit, so updatedAt catches payments on older visits.
    prisma.visit.findMany({
      where: {
        OR: [
          { updatedAt: { gte: new Date(prevFrom) } },
          { createdAt: { gte: new Date(prevFrom) } },
          { status: { not: "completed" } },
        ],
      },
      select: {
        branchId: true,
        kind: true,
        status: true,
        createdAt: true,
        timeline: true,
        payments: { select: { amount: true, paidAt: true } },
      },
    }),
    prisma.medicine.findMany({
      select: { id: true, unitPrice: true, costPrice: true, reorderLevel: true },
    }),
    prisma.medicineStock.findMany(),
    prisma.medicineBatch.findMany({
      where: { quantity: { gt: 0 }, expiryDate: { not: null } },
      select: { branchId: true, quantity: true, expiryDate: true },
    }),
    prisma.shift.findMany({
      where: {
        OR: [{ status: "open" }, { closedAt: { gte: new Date(from), lt: new Date(to) } }],
      },
      select: { branchId: true, status: true, cashShortageOverage: true },
    }),
    prisma.user.findMany({
      where: { active: true, role: { not: "admin" } },
      select: { branchId: true },
    }),
  ]);

  const buckets = buildBuckets({ from, to }, bucketUnitFor({ from, to }));
  const stats = new Map<string, BranchStats>();
  const statsFor = (branchId: string | null | undefined): BranchStats => {
    const id = branchId ?? mainId; // anything untagged belongs to the main branch
    let s = stats.get(id);
    if (!s) {
      s = {
        branchId: id,
        revenue: 0,
        previousRevenue: 0,
        inHouseRevenue: 0,
        communityRevenue: 0,
        payments: 0,
        visits: 0,
        completedVisits: 0,
        avgVisitMs: null,
        walkInSales: 0,
        openNow: 0,
        series: buckets.map(() => 0),
        stock: { valueRetail: 0, valueCost: 0, lowStock: 0, outOfStock: 0, expiringUnits: 0, expiredUnits: 0 },
        tills: { open: 0, discrepancies: 0, netShortage: 0 },
        staff: 0,
      };
      stats.set(id, s);
    }
    return s;
  };
  for (const b of branches) statsFor(b.id);

  // --- money and visits ------------------------------------------------------
  const durations = new Map<string, number[]>();
  for (const v of visits) {
    const s = statsFor(v.branchId);
    const walkIn = v.kind === "walk-in";
    let paidInPeriod = false;
    for (const p of v.payments) {
      const t = p.paidAt.getTime();
      if (t >= from && t < to) {
        s.revenue += p.amount;
        s.payments += 1;
        if (walkIn) s.communityRevenue += p.amount;
        else s.inHouseRevenue += p.amount;
        const i = bucketIndex(buckets, t);
        if (i >= 0) s.series[i] += p.amount;
        paidInPeriod = true;
      } else if (t >= prevFrom && t < from) {
        s.previousRevenue += p.amount;
      }
    }
    if (walkIn) {
      if (paidInPeriod) s.walkInSales += 1;
      continue; // counter sales are not visits
    }
    if (v.status !== "completed") s.openNow += 1;
    const created = v.createdAt.getTime();
    if (created >= from && created < to) {
      s.visits += 1;
      if (v.status === "completed") {
        s.completedVisits += 1;
        const done = v.timeline.find((e) => e.status === "completed");
        if (done && v.timeline.length > 1) {
          const list = durations.get(s.branchId) ?? [];
          list.push(done.at.getTime() - v.timeline[0].at.getTime());
          durations.set(s.branchId, list);
        }
      }
    }
  }
  for (const [id, list] of durations) {
    if (list.length) statsFor(id).avgVisitMs = list.reduce((a, b) => a + b, 0) / list.length;
  }

  // --- stock health ----------------------------------------------------------
  const medById = new Map(medicines.map((m) => [m.id, m]));
  for (const row of stockRows) {
    const m = medById.get(row.medicineId);
    if (!m) continue;
    const s = statsFor(row.branchId);
    if (row.quantity <= 0) {
      s.stock.outOfStock += 1;
      continue;
    }
    s.stock.valueRetail += row.quantity * m.unitPrice;
    s.stock.valueCost += row.quantity * (m.costPrice ?? 0);
    if (row.quantity <= (m.reorderLevel ?? DEFAULT_REORDER)) s.stock.lowStock += 1;
  }
  const soon = now + 90 * DAY_MS;
  for (const b of batches) {
    const s = statsFor(b.branchId);
    const exp = b.expiryDate!.getTime();
    if (exp < now) s.stock.expiredUnits += b.quantity;
    else if (exp <= soon) s.stock.expiringUnits += b.quantity;
  }

  // --- tills and staff -------------------------------------------------------
  for (const sh of shifts) {
    const s = statsFor(sh.branchId);
    if (sh.status === "open") s.tills.open += 1;
    else if (sh.status === "discrepancy") {
      s.tills.discrepancies += 1;
      s.tills.netShortage += sh.cashShortageOverage ?? 0;
    }
  }
  for (const u of users) statsFor(u.branchId).staff += 1;

  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    from,
    to,
    buckets: buckets.map((b) => ({ label: b.label, full: b.full })),
    branches: branches.map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      isMain: b.isMain,
      active: b.active,
    })),
    stats: [...stats.values()].map((s) => ({
      ...s,
      revenue: round(s.revenue),
      previousRevenue: round(s.previousRevenue),
      inHouseRevenue: round(s.inHouseRevenue),
      communityRevenue: round(s.communityRevenue),
      series: s.series.map(round),
      stock: { ...s.stock, valueRetail: round(s.stock.valueRetail), valueCost: round(s.stock.valueCost) },
      tills: { ...s.tills, netShortage: round(s.tills.netShortage) },
    })),
  };
}
