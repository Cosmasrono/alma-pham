import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

async function getUserPinHash(userId: string): Promise<string | null> {
  const result = (await prisma.$runCommandRaw({
    find: "User",
    filter: { _id: { $oid: userId } },
    projection: { pinHash: 1 },
    limit: 1,
  })) as { cursor?: { firstBatch?: Array<{ pinHash?: string | null }> } };

  const row = result.cursor?.firstBatch?.[0];
  return typeof row?.pinHash === "string" ? row.pinHash : null;
}

async function setUserPinHash(userId: string, pinHash: string): Promise<void> {
  await prisma.$runCommandRaw({
    update: "User",
    updates: [
      {
        q: { _id: { $oid: userId } },
        u: { $set: { pinHash } },
        upsert: false,
        multi: false,
      },
    ],
  });
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      mode?: "set" | "verify";
      pin?: string;
      currentPassword?: string;
    };

    const mode = body.mode;
    const pin = String(body.pin ?? "").trim();

    if (!mode || !validPin(pin)) {
      return NextResponse.json(
        { error: "PIN must be exactly 4 digits." },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.id },
      select: { id: true, passwordHash: true, active: true },
    });

    if (!user || !user.active) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (mode === "set") {
      const currentPassword = String(body.currentPassword ?? "");
      const passwordOk = await verifyPassword(currentPassword, user.passwordHash);
      if (!passwordOk) {
        return NextResponse.json(
          { error: "Current password is incorrect." },
          { status: 403 },
        );
      }

      await setUserPinHash(user.id, await hashPassword(pin));
      return NextResponse.json({ ok: true, hasPin: true });
    }

    const pinHash = await getUserPinHash(user.id);
    if (!pinHash) {
      return NextResponse.json(
        { error: "PIN is not set for this account.", code: "PIN_NOT_SET" },
        { status: 428 },
      );
    }

    const ok = await verifyPassword(pin, pinHash);
    if (!ok) {
      return NextResponse.json({ error: "Incorrect PIN." }, { status: 403 });
    }

    return NextResponse.json({ ok: true, hasPin: true });
  } catch (err) {
    console.error("POST /api/auth/pin failed", err);
    const msg = err instanceof Error ? err.message : "";
    if (/pinHash|Unknown arg|Unknown field/i.test(msg)) {
      return NextResponse.json(
        {
          error: "PIN setup not ready on server. Run: pnpm prisma generate",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: "PIN action failed." }, { status: 500 });
  }
}
