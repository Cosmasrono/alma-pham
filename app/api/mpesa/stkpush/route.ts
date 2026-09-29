// POST: send an STK push for a till — reception's pay-gates as well as the
// pharmacy checkout. The amount is computed server-side: the medicine catalog
// prices the cart, and whatever the visit still owes is added on, so the
// pushed amount always matches what checkoutVisit / payCharges will settle.
// Reception passes `chargeIds` to bill only the lines its gate is holding the
// patient for; the pharmacy omits them and sweeps up everything outstanding.
// GET: tells the POS whether PayHero credentials are configured.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mpesaConfigured, normalizePhone, stkPush } from "@/lib/server/mpesa";
import { checkPrescribedCart } from "@/lib/server/clinic-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ configured: mpesaConfigured() });
}

export async function POST(req: Request) {
  try {
    if (!mpesaConfigured()) {
      return NextResponse.json(
        { error: "M-Pesa is not configured on this server." },
        { status: 501 },
      );
    }

    const body = (await req.json()) as {
      phone?: string;
      accountReference?: string;
      visitId?: string;
      chargeIds?: string[];
      items?: { medicineId: string; quantity: number }[];
      // Walk-in counter: the outside prescription behind prescription-only items.
      walkIn?: { prescriber?: string; prescriberFacility?: string };
    };

    const phone = normalizePhone(body.phone ?? "");
    if (!phone) {
      return NextResponse.json(
        { error: "Enter a valid Safaricom number, e.g. 0712 345678." },
        { status: 400 },
      );
    }

    const items = (body.items ?? []).map((i) => ({
      medicineId: i.medicineId,
      quantity: Math.max(1, Math.round(i.quantity)),
    }));

    // Charges the patient ran up and has not settled — reception's gate, or
    // the pay-at-end bill. A visit with these owes money even with an empty
    // cart. Narrowing to `chargeIds` matters: the pushed amount has to equal
    // exactly what the till will settle, or the payment is rejected later.
    const wanted = body.chargeIds?.length ? new Set(body.chargeIds) : null;
    let outstanding = 0;
    if (body.visitId) {
      const visit = await prisma.visit.findUnique({
        where: { id: body.visitId },
      });
      outstanding = (visit?.charges ?? [])
        .filter((c) => !c.paid && (!wanted || wanted.has(c.id)))
        .reduce((s, c) => s + c.amount, 0);
    }
    if (items.length === 0 && outstanding === 0) {
      return NextResponse.json({ error: "The cart is empty." }, { status: 400 });
    }
    // Same rule checkout enforces — never take money for a cart it will refuse.
    if (body.visitId && items.length > 0) {
      const cartError = await checkPrescribedCart(body.visitId, items);
      if (cartError) return NextResponse.json({ error: cartError }, { status: 400 });
    }

    const medicines = await prisma.medicine.findMany({
      where: { id: { in: items.map((i) => i.medicineId) } },
    });
    const byId = new Map(medicines.map((m) => [m.id, m]));
    // Walk-in sale: same prescription-only rule sellWalkIn enforces.
    if (body.walkIn) {
      const rxOnly = items.some((i) => byId.get(i.medicineId)?.requiresPrescription);
      if (rxOnly && (!body.walkIn.prescriber?.trim() || !body.walkIn.prescriberFacility?.trim())) {
        return NextResponse.json(
          { error: "Record the prescribing doctor and facility before taking payment." },
          { status: 400 },
        );
      }
    }
    let amount = outstanding;
    for (const item of items) {
      const med = byId.get(item.medicineId);
      if (!med) {
        return NextResponse.json(
          { error: "A carted medicine no longer exists." },
          { status: 400 },
        );
      }
      amount += item.quantity * med.unitPrice;
    }
    amount = Math.max(1, Math.round(amount));

    // A push the POS gave up on can still settle late. If this phone already
    // paid this amount recently and the money was never tied to a visit,
    // reuse that payment instead of charging the customer twice.
    const settled = await prisma.mpesaTransaction.findFirst({
      where: {
        phone,
        amount,
        status: "success",
        receipt: { not: null },
        visitId: null,
        createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (settled) {
      return NextResponse.json({
        checkoutRequestId: settled.checkoutRequestId,
        amount,
        reused: true,
      });
    }

    const push = await stkPush({
      phone,
      amount,
      accountReference: body.accountReference ?? "AmlaMedicare",
      description: items.length > 0 ? "Pharmacy" : "Clinic fees",
    });
    if (!push.ok || !push.checkoutRequestId) {
      return NextResponse.json(
        { error: push.error ?? "M-Pesa request failed." },
        { status: 502 },
      );
    }

    await prisma.mpesaTransaction.create({
      data: {
        checkoutRequestId: push.checkoutRequestId,
        phone,
        amount,
        status: "pending",
        resultDesc: [
          push.payheroReference
            ? `PayHero reference: ${push.payheroReference}`
            : null,
          push.payheroCheckoutRequestId
            ? `CheckoutRequestID: ${push.payheroCheckoutRequestId}`
            : null,
        ]
          .filter(Boolean)
          .join("; "),
      },
    });
    return NextResponse.json({
      checkoutRequestId: push.checkoutRequestId,
      amount,
    });
  } catch (err) {
    console.error("POST /api/mpesa/stkpush failed", err);
    return NextResponse.json(
      { error: "M-Pesa request failed." },
      { status: 500 },
    );
  }
}
