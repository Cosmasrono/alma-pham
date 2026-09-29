// Is the system locked by developer support? Polled by every signed-in screen so staff
// who were already working see the lock notice promptly.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { lockMessageFor, systemLock } from "@/lib/server/developer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const lock = await systemLock();
  return NextResponse.json({
    locked: lock.locked,
    message: lock.locked ? lockMessageFor(lock) : null,
    // The developer account keeps working while it's locked.
    appliesToMe: lock.locked && session.role !== "developer",
  });
}
