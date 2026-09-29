// PayHero posts the STK result here when PAYHERO_CALLBACK_URL points to this
// public HTTPS route. Polling also works, so local dev does not require this.
//
// Reached unauthenticated because PayHero has no session.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PayHeroCallback {
  response?: {
    Amount?: number;
    CheckoutRequestID?: string;
    ExternalReference?: string;
    MpesaReceiptNumber?: string;
    ResultCode?: number;
    ResultDesc?: string;
    Status?: string;
  };
  status?: boolean;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PayHeroCallback;
    const cb = body.response;
    const externalReference = cb?.ExternalReference;
    const checkoutRequestId = cb?.CheckoutRequestID;

    if (externalReference || checkoutRequestId) {
      const tx = await prisma.mpesaTransaction.findFirst({
        where: {
          OR: [
            externalReference
              ? { checkoutRequestId: externalReference }
              : undefined,
            checkoutRequestId ? { checkoutRequestId } : undefined,
            checkoutRequestId
              ? { resultDesc: { contains: checkoutRequestId } }
              : undefined,
          ].filter(Boolean) as { checkoutRequestId?: string; resultDesc?: { contains: string } }[],
        },
      });

      if (tx) {
        const success =
          body.status === true ||
          cb?.ResultCode === 0 ||
          cb?.Status?.toLowerCase() === "success";

        await prisma.mpesaTransaction.update({
          where: { checkoutRequestId: tx.checkoutRequestId },
          data: {
            status: success ? "success" : "failed",
            receipt: cb?.MpesaReceiptNumber ?? undefined,
            resultDesc: cb?.ResultDesc ?? cb?.Status ?? undefined,
          },
        });
      }
    }
  } catch (err) {
    console.error("PayHero callback parse failed", err);
  }

  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
