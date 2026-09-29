// AI assistant endpoint.
//   POST /api/ai  → { messages: [{ role: "user" | "assistant", content }] }
// Streams a plain-text answer from Claude, grounded in a live snapshot of the
// clinic dataset. Any logged-in staff member may use it; the snapshot handed
// to the model is the same data the caller can already see in the app.

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import * as repo from "@/lib/server/clinic-repo";
import { getSession } from "@/lib/auth/session";
import { canView, ROLE_LABELS } from "@/lib/auth/roles";
import { clinicVisits, isWalkIn, paymentsOf } from "@/lib/selectors";
import type { ClinicData, Visit } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TURNS = 20; // cap history so requests stay small

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type AiProvider = "anthropic" | "groq";

/** Extra sections only an administrator's assistant gets to see. */
function adminSnapshot(data: ClinicData): string {
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
  // Every payment, not just the one that closed the visit — per-stage patients
  // pay for the consultation and their labs on the way through.
  const takingsWeek = data.visits
    .flatMap((v) => paymentsOf(v).map((payment) => ({ visit: v, payment })))
    .filter((t) => new Date(t.payment.paidAt).getTime() >= weekStart);
  const paidWeek = [...new Set(takingsWeek.map((t) => t.visit))];
  const revenueWeek = takingsWeek.reduce((s, t) => s + t.payment.amount, 0);

  const byMethod = new Map<string, number>();
  for (const { payment } of takingsWeek) {
    byMethod.set(
      payment.method,
      (byMethod.get(payment.method) ?? 0) + payment.amount,
    );
  }

  const sales = new Map<string, { qty: number; amount: number }>();
  for (const v of paidWeek) {
    for (const item of v.saleItems ?? []) {
      const entry = sales.get(item.name) ?? { qty: 0, amount: 0 };
      entry.qty += item.quantity;
      entry.amount += item.quantity * item.unitPrice;
      sales.set(item.name, entry);
    }
  }
  const topSellers = [...sales.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 5)
    .map(([name, s]) => `- ${name}: ${s.qty} units, KSh ${s.amount}`);

  const walkInsWeek = paidWeek.filter(isWalkIn).length;
  // Counter sales take no time in the clinic — they'd drag the average down.
  const durations = clinicVisits(data)
    .filter((v) => v.status === "completed")
    .map((v) => {
      const t = v.timeline;
      const done = t?.find((e) => e.status === "completed");
      return t && done
        ? new Date(done.at).getTime() - new Date(t[0].at).getTime()
        : null;
    })
    .filter((ms): ms is number => ms !== null);
  const avgMins =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 60000)
      : null;

  return [
    "=== ADMIN-ONLY DETAIL ===",
    `Revenue last 7 days: KSh ${revenueWeek} across ${paidWeek.length - walkInsWeek} paid clinic visits and ${walkInsWeek} walk-in pharmacy counter sales (${[...byMethod.entries()].map(([m, a]) => `${m}: KSh ${a}`).join(", ") || "no payments"}).`,
    topSellers.length > 0
      ? `Top-selling medicines (7 days):\n${topSellers.join("\n")}`
      : "No pharmacy sales in the last 7 days.",
    avgMins !== null
      ? `Average time in clinic across all completed visits: ${avgMins} min.`
      : "No completed visits with timing data yet.",
    `Doctor roster: ${data.doctors.map((d) => d.name).join(", ") || "none"}.`,
  ].join("\n\n");
}

/** Compact, token-bounded summary of the clinic for the system prompt. */
function snapshot(data: ClinicData): string {
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const open = data.visits.filter((v) => v.status !== "completed");
  const byStatus = new Map<string, number>();
  for (const v of open) byStatus.set(v.status, (byStatus.get(v.status) ?? 0) + 1);

  const paidToday = data.visits.filter(
    (v) => v.payment && new Date(v.payment.paidAt).getTime() >= dayStart.getTime(),
  );
  const revenueToday = paidToday.reduce((s, v) => s + (v.payment?.amount ?? 0), 0);

  const patientName = (v: Visit) => {
    const p = data.patients.find((p) => p.id === v.patientId);
    return p ? `${p.firstName} ${p.lastName} (${p.mrn})` : "unknown patient";
  };

  const openLines = open.slice(0, 30).map((v) => {
    const doctor = data.doctors.find((d) => d.id === v.assignedDoctorId)?.name;
    const mins = Math.round((now - new Date(v.createdAt).getTime()) / 60000);
    return `- ${patientName(v)}: ${v.status}${v.priority ? `, ${v.priority}` : ""}${doctor ? `, doctor ${doctor}` : ""}, in clinic ${mins} min${v.complaint ? `, complaint: ${v.complaint}` : ""}`;
  });

  const lowStock = data.medicines
    .filter((m) => m.stock <= 10)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 15)
    .map((m) => `- ${m.name} ${m.strength}: ${m.stock} left @ KSh ${m.unitPrice}`);

  const pendingOrders = data.orders.filter((o) => o.status !== "completed");

  return [
    `Current date/time: ${new Date().toISOString()}`,
    `Totals: ${data.patients.length} patients, ${clinicVisits(data).length} clinic visits (${open.length} open), ${data.visits.length - clinicVisits(data).length} walk-in pharmacy counter sales, ${data.orders.length} orders (${pendingOrders.length} pending), ${data.medicines.length} catalog medicines, ${data.doctors.length} doctors.`,
    `Queue right now: ${[...byStatus.entries()].map(([s, n]) => `${s}: ${n}`).join(", ") || "empty"}.`,
    `Revenue today: KSh ${revenueToday} across ${paidToday.length} paid visits.`,
    open.length > 0 ? `Open visits:\n${openLines.join("\n")}` : "No patients in the building.",
    lowStock.length > 0 ? `Low-stock medicines (≤10 units):\n${lowStock.join("\n")}` : "No low-stock medicines.",
  ].join("\n\n");
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const provider: AiProvider | null = process.env.ANTHROPIC_API_KEY
    ? "anthropic"
    : process.env.GROQ_API_KEY
      ? "groq"
      : null;

  if (!provider) {
    return NextResponse.json(
      {
        error:
          "AI is not configured. Set ANTHROPIC_API_KEY or GROQ_API_KEY in .env and restart.",
      },
      { status: 503 },
    );
  }

  let messages: ChatMessage[];
  try {
    const body = await req.json();
    messages = (body.messages as ChatMessage[]).filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim() !== "",
    );
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "Send a user message" }, { status: 400 });
  }

  try {
    const data = await repo.getClinicData();

    const isAdmin = canView(session.role, "ai.admin_insights");
    const system = [
      "You are the Amla Medicare assistant, embedded in a small clinic's management app in Kenya.",
      `You are talking to ${session.name}, a ${ROLE_LABELS[session.role]}.`,
      isAdmin
        ? "The user is an administrator with full visibility over the clinic — answer freely about finances, staffing, throughput and every station, and point them to the Reports page for deeper breakdowns."
        : "The user is station staff — focus on their day-to-day work (queues, patients, stock) rather than clinic-wide finances.",
      "Answer questions about the clinic using the live snapshot below. Help staff spot bottlenecks (long-staying patients, busy stations), summarize revenue and stock, and suggest next actions inside the app (Reception, Doctor, Lab/Radiology, Pharmacy, Reports pages).",
      "You cannot modify data — when an action is needed, tell the user which page to do it on.",
      "Be concise and concrete. Amounts are in Kenyan Shillings (KSh).",
      "The chat panel renders markdown, so use it where it genuinely helps: **bold** for figures that matter, short bullet lists for several items, and a markdown table when comparing three or more rows across the same columns. Keep to two or three short sections — this is a chat panel, not a report.",
      "If asked something the snapshot cannot answer (e.g. medical advice or data outside the app), say so briefly.",
      "",
      "=== LIVE CLINIC SNAPSHOT ===",
      snapshot(data),
      ...(isAdmin ? ["", adminSnapshot(data)] : []),
    ].join("\n");

    if (provider === "groq") {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          // Groq retires model ids periodically; GROQ_MODEL overrides without
          // a code change. Check https://api.groq.com/openai/v1/models.
          model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
          temperature: 0.2,
          messages: [
            { role: "system", content: system },
            ...messages.slice(-MAX_TURNS),
          ],
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            error?: { message?: string };
            choices?: Array<{ message?: { content?: string | null } }>;
          }
        | null;

      if (!response.ok) {
        return NextResponse.json(
          {
            error:
              payload?.error?.message ??
              "GROQ request failed. Check GROQ_API_KEY and try again.",
          },
          { status: response.status || 503 },
        );
      }

      const text = payload?.choices?.[0]?.message?.content?.trim();
      if (!text) {
        return NextResponse.json(
          { error: "GROQ returned an empty response." },
          { status: 502 },
        );
      }

      return new Response(text, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    const client = new Anthropic();

    const stream = client.messages.stream({
      model: "claude-opus-4-7",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system,
      messages: messages.slice(-MAX_TURNS),
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream.on("text", (delta) => controller.enqueue(encoder.encode(delta)));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => {
          console.error("AI stream failed", err);
          controller.error(err);
        });
      },
      cancel() {
        stream.abort();
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("POST /api/ai failed", err);
    if (provider === "anthropic" && err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "Invalid ANTHROPIC_API_KEY." },
        { status: 503 },
      );
    }
    if (provider === "anthropic" && err instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "AI is rate-limited right now. Try again shortly." },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "AI request failed" }, { status: 500 });
  }
}
