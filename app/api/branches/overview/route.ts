// Cross-branch overview for the admin dashboard: every branch side by side
// for one period, whatever branch the admin happens to be viewing.
//   GET /api/branches/overview?from=<ms>&to=<ms>

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canView } from "@/lib/auth/roles";
import { computeBranchOverview } from "@/lib/server/branch-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canView(session.role, "clinic.finance.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const to = Number(url.searchParams.get("to")) || Date.now();
  // "All time" arrives as 0 — the overview starts from the first visit.
  const from = Number(url.searchParams.get("from")) || 0;
  if (!(to > from)) return NextResponse.json({ error: "Invalid range." }, { status: 400 });
  return NextResponse.json(await computeBranchOverview(from, to));
}
