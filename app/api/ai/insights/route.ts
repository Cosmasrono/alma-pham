// AI inventory insights for the pharmacy.
//   GET  /api/ai/insights → the latest stored analysis
//   POST /api/ai/insights → run a fresh analysis
// Per medicine: a 30-day demand forecast, how much to reorder, stockout risk
// and expiry risk (stock that won't sell before it expires). Plus an audit of
// the last 30 days' payments against what was sold.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { canView, hasPermission } from "@/lib/auth/roles";
import { branchContext } from "@/lib/server/branches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_MEDICINES = 40; // keeps the prompt bounded; most relevant first
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// JSON mode needs a model that honours response_format; override via env.
const GROQ_MODEL = process.env.GROQ_INSIGHTS_MODEL || "openai/gpt-oss-120b";

const RISKS = ["none", "low", "medium", "high"] as const;
type Risk = (typeof RISKS)[number];

export interface MedicinePrediction {
  medicineId: string;
  predictedDemandNext30Days: number;
  recommendedReorderQuantity: number;
  stockoutRisk: Risk;
  expiryRisk: Risk;
  confidence: number;
  reasoning: string;
  /** The figures the forecast was made from, shown next to it. */
  snapshot: {
    sellable: number;
    expired: number;
    sold30: number;
    sold90: number;
    expiringSoon: number; // units in batches expiring within 90 days
  };
}

async function authorise() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  // Stock managers (pharmacists), admins, and the developer (view only — its
  // POST is refused before it gets here).
  if (
    !canView(session.role, "clinic.medicine.manage") &&
    !hasPermission(session.role, "clinic.finance.manage")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  // Analyses are per branch (or all branches together, for admins).
  return { session, branch: await branchContext(session) };
}

/** Stored analyses for the branch in view; null view = all branches. */
function forBranch(view: string | null) {
  return view ? { branchId: view } : { OR: [{ branchId: null }, { branchId: { isSet: false } }] };
}

export async function GET() {
  const { error, branch } = await authorise();
  if (error) return error;
  const latest = await prisma.aiInsight.findFirst({
    where: forBranch(branch!.viewBranchId),
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    insight: latest
      ? {
          summary: latest.summary,
          paymentAudit: latest.paymentAudit ?? null,
          predictions: latest.predictions as unknown as MedicinePrediction[],
          paymentSnapshot: latest.paymentSnapshot ?? null,
          generatedAt: latest.createdAt.toISOString(),
          generatedBy: latest.generatedBy ?? null,
          model: latest.model ?? null,
        }
      : null,
    configured: Boolean(process.env.GROQ_API_KEY),
  });
}

/** Payments taken in the window, split by method and by where the sale came
 *  from, against what those payments were for. */
function paymentSnapshot(
  visits: {
    kind: string | null;
    charges: { id: string; amount: number }[];
    payments: { method: string; amount: number; paidAt: Date; covers: string[] }[];
  }[],
  mpesaConfirmed: number,
  since: Date,
) {
  let cash = 0;
  let mpesa = 0;
  let card = 0;
  let billed = 0; // value of the charges those payments said they settled
  let community = 0;
  let inHouse = 0;
  let payments = 0;
  for (const v of visits) {
    const chargeById = new Map(v.charges.map((c) => [c.id, c.amount]));
    for (const p of v.payments) {
      if (p.paidAt < since) continue;
      payments++;
      if (p.method === "cash") cash += p.amount;
      else if (p.method === "mpesa") mpesa += p.amount;
      else card += p.amount;
      if (v.kind === "walk-in") community += p.amount;
      else inHouse += p.amount;
      billed += p.covers.reduce((s, id) => s + (chargeById.get(id) ?? 0), 0);
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const collected = cash + mpesa + card;
  return {
    days: 30,
    payments,
    collected: round(collected),
    cash: round(cash),
    mpesa: round(mpesa),
    card: round(card),
    billed: round(billed),
    collectedVsBilledVariance: round(collected - billed),
    mpesaConfirmedByProvider: round(mpesaConfirmed),
    mpesaVariance: round(mpesaConfirmed - mpesa),
    inHouseSales: round(inHouse),
    communitySales: round(community),
  };
}

const clampRisk = (r: unknown): Risk => (RISKS.includes(r as Risk) ? (r as Risk) : "low");
const clampNum = (n: unknown, min = 0, max = 1_000_000) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : 0;
};

export async function POST() {
  const { session, branch, error } = await authorise();
  if (error) return error;
  const view = branch!.viewBranchId;
  const inBranch = view ? { branchId: view } : {};
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { error: "AI is not configured. Set GROQ_API_KEY in .env and restart the server." },
      { status: 503 },
    );
  }

  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * DAY_MS);
  const d90 = new Date(now.getTime() - 90 * DAY_MS);
  const soon = new Date(now.getTime() + 90 * DAY_MS);

  const [medicines, batches, visits, mpesaAgg, branchStock] = await Promise.all([
    prisma.medicine.findMany(),
    prisma.medicineBatch.findMany({ where: { quantity: { gt: 0 }, ...inBranch } }),
    // Sales from both pharmacies in the last 90 days (a sale closes its visit,
    // so updatedAt is at or after the sale).
    prisma.visit.findMany({
      where: { updatedAt: { gte: d90 }, ...inBranch },
      select: { kind: true, saleItems: true, charges: true, payments: true },
    }),
    // M-Pesa confirmations aren't tagged with a branch, so this total is
    // clinic-wide; the audit prompt says so.
    prisma.mpesaTransaction.aggregate({
      where: { status: "success", createdAt: { gte: d30 } },
      _sum: { amount: true },
    }),
    view ? prisma.medicineStock.findMany({ where: { branchId: view } }) : Promise.resolve([]),
  ]);
  const stockHere = new Map(branchStock.map((s) => [s.medicineId, s.quantity]));

  if (medicines.length === 0) {
    return NextResponse.json({ error: "There are no medicines in the catalog yet." }, { status: 422 });
  }

  // Units sold per medicine, dated by the payment that closed the sale.
  const sold = new Map<string, { sold30: number; sold90: number }>();
  for (const v of visits) {
    if (!v.saleItems.length) continue;
    const saleAt = v.payments.reduce<Date | null>(
      (latest, p) => (!latest || p.paidAt > latest ? p.paidAt : latest),
      null,
    );
    if (!saleAt || saleAt < d90) continue;
    for (const item of v.saleItems) {
      const s = sold.get(item.medicineId) ?? { sold30: 0, sold90: 0 };
      s.sold90 += item.quantity;
      if (saleAt >= d30) s.sold30 += item.quantity;
      sold.set(item.medicineId, s);
    }
  }

  const shelf = new Map<string, { sellable: number; expired: number; expiringSoon: number; nextExpiryDays: number | null }>();
  for (const b of batches) {
    const s = shelf.get(b.medicineId) ?? { sellable: 0, expired: 0, expiringSoon: 0, nextExpiryDays: null };
    if (b.expiryDate && b.expiryDate < now) s.expired += b.quantity;
    else {
      s.sellable += b.quantity;
      if (b.expiryDate && b.expiryDate <= soon) s.expiringSoon += b.quantity;
      if (b.expiryDate) {
        const days = Math.ceil((b.expiryDate.getTime() - now.getTime()) / DAY_MS);
        if (s.nextExpiryDays === null || days < s.nextExpiryDays) s.nextExpiryDays = days;
      }
    }
    shelf.set(b.medicineId, s);
  }

  // Most relevant first: what's selling, then what's about to expire, then
  // what's running low against its reorder level.
  const rows = medicines
    .map((m) => {
      const s = sold.get(m.id) ?? { sold30: 0, sold90: 0 };
      const sh = shelf.get(m.id);
      // No batches → the plain count (this branch's, or the all-branch total).
      const sellable = sh ? sh.sellable : view ? (stockHere.get(m.id) ?? 0) : m.stock;
      return {
        m,
        ...s,
        sellable,
        expired: sh?.expired ?? 0,
        expiringSoon: sh?.expiringSoon ?? 0,
        nextExpiryDays: sh?.nextExpiryDays ?? null,
        reorder: m.reorderLevel ?? 10,
      };
    })
    .sort(
      (a, b) =>
        b.sold90 - a.sold90 ||
        b.expiringSoon - a.expiringSoon ||
        a.sellable - a.reorder - (b.sellable - b.reorder),
    )
    .slice(0, MAX_MEDICINES);

  const lines = rows.map(
    (r) =>
      `id=${r.m.id} | ${r.m.name} ${r.m.strength} ${r.m.form}${r.m.genericName ? ` (${r.m.genericName})` : ""}` +
      ` | sellable_now=${r.sellable} | expired_blocked=${r.expired} | reorder_level=${r.reorder}` +
      ` | sold_last_30d=${r.sold30} | sold_last_90d=${r.sold90}` +
      ` | expiring_within_90d=${r.expiringSoon}${r.nextExpiryDays !== null ? ` | next_expiry_in_days=${r.nextExpiryDays}` : ""}` +
      ` | price=${r.m.unitPrice}${r.m.requiresPrescription ? " | prescription_only" : ""}`,
  );

  const payments = paymentSnapshot(visits, mpesaAgg._sum.amount ?? 0, d30);

  const system = [
    "You are the inventory analyst for a clinic pharmacy in Kenya that sells both to clinic patients (in-house) and over the counter (community walk-ins).",
    "Forecast each medicine's demand for the next 30 days from its 30- and 90-day sales, and recommend how many units to reorder now.",
    "Be realistic: keep confidence low when sales history is thin, and recommend 0 reorder when sellable stock comfortably covers forecast demand plus the reorder level.",
    "Expiry risk: stock expiring within 90 days that forecast demand will not use up in time is at risk — say so, and never recommend reordering an item whose current stock will not sell before it expires.",
    "Respond with one JSON object only, no markdown:",
    '{ "summary": "2-4 sentences: the inventory situation and the most urgent actions",',
    '  "paymentAudit": "2-4 sentences: do payments collected match what was billed, and does M-Pesa recorded match M-Pesa confirmed? Name any gap and its likely cause. (mpesaConfirmedByProvider is clinic-wide across all branches; if the figures are for one branch, a higher confirmed total is expected and is not a discrepancy on its own.)",',
    '  "predictions": [ { "medicineId": "exactly as given", "predictedDemandNext30Days": number, "recommendedReorderQuantity": integer, "stockoutRisk": "none"|"low"|"medium"|"high", "expiryRisk": "none"|"low"|"medium"|"high", "confidence": number 0-1, "reasoning": "one sentence" } ] }',
    "Include exactly one prediction per medicine given. Amounts are KSh.",
  ].join("\n");

  const user = `Today is ${now.toISOString().slice(0, 10)}.\n\nMedicines:\n${lines.join("\n")}\n\nPayments, last 30 days:\n${JSON.stringify(payments)}`;

  let text: string;
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.2,
        max_completion_tokens: 12000,
        // gpt-oss "thinks" before answering; keep that short so the JSON
        // answer always has room (an exhausted budget returns nothing).
        ...(GROQ_MODEL.startsWith("openai/gpt-oss") && { reasoning_effort: "low" }),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (res.status === 401) {
      return NextResponse.json({ error: "The GROQ_API_KEY is invalid. Check it in .env." }, { status: 503 });
    }
    if (res.status === 429) {
      return NextResponse.json({ error: "The AI service is busy (rate limited). Try again in a minute." }, { status: 429 });
    }
    if (!res.ok) {
      console.error("AI insights: Groq failed", res.status, await res.text().catch(() => ""));
      return NextResponse.json({ error: "The AI request failed. Try again shortly." }, { status: 502 });
    }
    const body = await res.json();
    text = body?.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    console.error("AI insights request failed", err);
    return NextResponse.json({ error: "The AI request failed or timed out. Try again shortly." }, { status: 502 });
  }

  let parsed: { summary?: unknown; paymentAudit?: unknown; predictions?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "The AI returned an unreadable answer. Try again." }, { status: 502 });
  }

  // Never trust the model's shape: keep only medicines we asked about, clamp
  // every number, and attach the real figures the forecast was based on.
  const byId = new Map(rows.map((r) => [r.m.id, r]));
  const seen = new Set<string>();
  const predictions: MedicinePrediction[] = [];
  for (const raw of Array.isArray(parsed.predictions) ? parsed.predictions : []) {
    const p = raw as Record<string, unknown>;
    const id = String(p.medicineId ?? "");
    const r = byId.get(id);
    if (!r || seen.has(id)) continue;
    seen.add(id);
    predictions.push({
      medicineId: id,
      predictedDemandNext30Days: Math.round(clampNum(p.predictedDemandNext30Days)),
      recommendedReorderQuantity: Math.round(clampNum(p.recommendedReorderQuantity)),
      stockoutRisk: clampRisk(p.stockoutRisk),
      expiryRisk: clampRisk(p.expiryRisk),
      confidence: clampNum(p.confidence, 0, 1),
      reasoning: String(p.reasoning ?? "").slice(0, 400),
      snapshot: {
        sellable: r.sellable,
        expired: r.expired,
        sold30: r.sold30,
        sold90: r.sold90,
        expiringSoon: r.expiringSoon,
      },
    });
  }
  if (predictions.length === 0) {
    return NextResponse.json({ error: "The AI didn't return any usable forecasts. Try again." }, { status: 502 });
  }

  const saved = await prisma.aiInsight.create({
    data: {
      summary: String(parsed.summary ?? "").slice(0, 2000) || "No summary returned.",
      paymentAudit: parsed.paymentAudit ? String(parsed.paymentAudit).slice(0, 2000) : null,
      predictions: predictions as unknown as object,
      paymentSnapshot: payments,
      model: GROQ_MODEL,
      generatedBy: session!.name,
      branchId: view,
    },
  });

  return NextResponse.json({
    insight: {
      summary: saved.summary,
      paymentAudit: saved.paymentAudit,
      predictions,
      paymentSnapshot: payments,
      generatedAt: saved.createdAt.toISOString(),
      generatedBy: saved.generatedBy,
      model: saved.model,
    },
    configured: true,
  });
}
