// GET /api/mpesa/status?id=<CheckoutRequestID>

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stkQuery } from "@/lib/server/mpesa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PENDING_TTL_MS = 2 * 60_000;

// resultDesc stores "PayHero reference: X; CheckoutRequestID: Y" — pull out
// the actual PayHero reference for status queries.
function payheroRefFrom(resultDesc: string | null, fallback: string): string {
  const m = resultDesc?.match(/PayHero reference:\s*([^;]+)/);
  return m?.[1]?.trim() || fallback;
}

export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const tx = await prisma.mpesaTransaction.findUnique({
      where: { checkoutRequestId: id },
    });
    if (!tx) {
      return NextResponse.json({ error: "Unknown transaction" }, { status: 404 });
    }

    // Already settled (by the callback or an earlier poll).
    // A "success" row is a success — receipt is metadata, not proof.
    if (tx.status !== "pending") {
      return NextResponse.json({
        status: tx.status,
        receipt: tx.receipt ?? undefined,
        detail: tx.resultDesc ?? undefined,
      });
    }

    const result = await stkQuery(payheroRefFrom(tx.resultDesc, id));

    if (result.status === "pending") {
      if (Date.now() - tx.createdAt.getTime() < PENDING_TTL_MS) {
        return NextResponse.json({ status: "pending" });
      }
      const expired = await prisma.mpesaTransaction.update({
        where: { checkoutRequestId: id },
        data: {
          status: "failed",
          resultDesc: "Timed out waiting for M-Pesa confirmation.",
        },
      });
      return NextResponse.json({
        status: "failed",
        detail: expired.resultDesc ?? undefined,
      });
    }

    const success = result.status === "success";
    const updated = await prisma.mpesaTransaction.update({
      where: { checkoutRequestId: id },
      data: {
        status: success ? "success" : "failed",
        receipt: success ? result.receipt ?? undefined : undefined,
        resultDesc: success
          ? "Payment confirmed"
          : result.detail ?? "Payment failed.",
      },
    });
    return NextResponse.json({
      status: updated.status,
      receipt: updated.receipt ?? undefined,
      detail: updated.resultDesc ?? undefined,
    });
  } catch (err) {
    console.error("GET /api/mpesa/status failed", err);
    return NextResponse.json({ status: "pending" });
  }
}