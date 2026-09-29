// AI reconciliation check.
//   POST /api/ai/reconciliation → { from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" }
// Runs Claude over the period's recorded payments, confirmed M-Pesa
// transactions and daily cash counts, and returns a plain-text verdict:
// what balances, exactly where the variances are, and what to investigate.

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import * as repo from "@/lib/server/clinic-repo";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/roles";
import { paymentsOf } from "@/lib/selectors";
import type { ClinicData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Local calendar day of an ISO timestamp, as "YYYY-MM-DD". */
function dayOf(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Compact, token-bounded reconciliation dataset for the model. */
function reconciliationSnapshot(data: ClinicData, from: number, to: number): string {
  interface Day {
    cash: number;
    mpesa: number;
    card: number;
    mpesaConfirmed: number;
    counted?: number;
  }
  const days = new Map<string, Day>();
  const day = (k: string): Day => {
    let d = days.get(k);
    if (!d) {
      d = { cash: 0, mpesa: 0, card: 0, mpesaConfirmed: 0 };
      days.set(k, d);
    }
    return d;
  };

  const inPeriod = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= from && t <= to;
  };

  // Every payment on every visit — per-stage patients pay reception for the
  // consultation and their labs long before the pharmacy sees them.
  const mpesaVisits: string[] = [];
  for (const v of data.visits) {
    for (const p of paymentsOf(v)) {
      if (!inPeriod(p.paidAt)) continue;
      const d = day(dayOf(p.paidAt));
      if (p.method === "cash") d.cash += p.amount;
      else if (p.method === "mpesa") {
        d.mpesa += p.amount;
        mpesaVisits.push(
          `- visit ${v.id.slice(-6)}: KSh ${p.amount} on ${p.paidAt}` +
            (p.reference ? ` ref ${p.reference}` : " (no reference recorded)"),
        );
      } else d.card += p.amount;
    }
  }

  const txnLines: string[] = [];
  for (const t of data.mpesaTransactions) {
    if (!inPeriod(t.createdAt)) continue;
    if (t.status === "success") day(dayOf(t.createdAt)).mpesaConfirmed += t.amount;
    txnLines.push(
      `- ${t.createdAt} KSh ${t.amount} status=${t.status}` +
        (t.receipt ? ` receipt=${t.receipt}` : "") +
        (t.visitId ? ` visit=${t.visitId.slice(-6)}` : " (not linked to a visit)"),
    );
  }

  for (const c of data.cashCounts) {
    const t = new Date(`${c.date}T12:00:00`).getTime();
    if (t < from || t > to) continue;
    day(c.date).counted = c.counted;
  }

  const dayLines = [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, d]) => {
      const cashVar = d.counted !== undefined ? (d.counted - d.cash).toFixed(0) : "not counted";
      return (
        `- ${k}: cash recorded ${d.cash}, cash counted ${d.counted ?? "—"} (variance ${cashVar}); ` +
        `M-Pesa recorded ${d.mpesa}, M-Pesa confirmed ${d.mpesaConfirmed} (variance ${(d.mpesaConfirmed - d.mpesa).toFixed(0)}); card ${d.card}`
      );
    });

  return [
    `Period: ${new Date(from).toISOString()} → ${new Date(to).toISOString()}. All amounts in KSh.`,
    dayLines.length ? `Per-day summary:\n${dayLines.join("\n")}` : "No payments in this period.",
    txnLines.length
      ? `All M-Pesa STK transactions in the period (max 100 shown):\n${txnLines.slice(0, 100).join("\n")}`
      : "No M-Pesa STK transactions in the period.",
    mpesaVisits.length
      ? `Visits paid as M-Pesa (max 100 shown):\n${mpesaVisits.slice(0, 100).join("\n")}`
      : "No visits paid via M-Pesa in the period.",
  ].join("\n\n");
}

const SYSTEM = [
  "You are a financial reconciliation auditor for a small clinic in Kenya.",
  "You are given: (a) per-day totals of every payment recorded in the clinic (reception pay-gates and the pharmacy POS) split by method,",
  "(b) the physically counted cash per day where an admin entered a count,",
  "(c) every M-Pesa STK transaction with its status, and (d) every visit paid as M-Pesa with its reference.",
  "Your job: state clearly whether the money balances, and if not, find exactly where the variance is.",
  "Cross-match M-Pesa visits against successful transactions (by amount, timestamp proximity and receipt/reference) and call out:",
  "- days where counted cash differs from recorded cash (state the exact shortage/overage),",
  "- M-Pesa recorded on visits with no matching successful transaction (payment may have failed or been reversed),",
  "- successful M-Pesa transactions not linked to any visit (money received but no sale recorded),",
  "- days with no cash count entered (recommend counting).",
  "Format: plain text, no markdown. Start with a one-line verdict (BALANCED or VARIANCE FOUND with the total amount).",
  "Then a short numbered list of specific findings with dates and amounts, most important first.",
  "End with one or two concrete next actions. Amounts in KSh. Be precise — never invent figures not present in the data.",
].join(" ");

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.role, "clinic.finance.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const provider = process.env.ANTHROPIC_API_KEY
    ? "anthropic"
    : process.env.GROQ_API_KEY
      ? "groq"
      : null;
  if (!provider) {
    return NextResponse.json(
      { error: "AI is not configured. Set ANTHROPIC_API_KEY or GROQ_API_KEY in .env and restart." },
      { status: 503 },
    );
  }

  let from: number;
  let to: number;
  try {
    const body = (await req.json().catch(() => ({}))) as { from?: string; to?: string };
    to = body.to ? new Date(`${body.to}T23:59:59.999`).getTime() : Date.now();
    from = body.from
      ? new Date(`${body.from}T00:00:00`).getTime()
      : to - 7 * 24 * 60 * 60 * 1000;
    if (Number.isNaN(from) || Number.isNaN(to)) throw new Error("bad dates");
  } catch {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  try {
    const data = await repo.getClinicData({ includeFinance: true });
    const userPrompt = `Reconcile the following data:\n\n${reconciliationSnapshot(data, from, to)}`;

    if (provider === "groq") {
      // Groq retires model ids periodically; GROQ_MODEL overrides without
      // a code change. Check https://api.groq.com/openai/v1/models.
      const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
      // gpt-oss is a reasoning model: it can spend its whole output budget
      // "thinking" and come back with no answer. Cap the thinking, give the
      // answer room, and retry once if it's still empty.
      let lastReason = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_completion_tokens: 6000,
            ...(model.startsWith("openai/gpt-oss") && { reasoning_effort: "low" }),
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: userPrompt },
            ],
          }),
          signal: AbortSignal.timeout(60_000),
        });
        const payload = (await res.json().catch(() => null)) as {
          error?: { message?: string };
          choices?: Array<{
            finish_reason?: string;
            message?: { content?: string | null };
          }>;
          usage?: unknown;
        } | null;
        if (!res.ok) {
          return NextResponse.json(
            { error: payload?.error?.message ?? "GROQ request failed." },
            { status: res.status || 503 },
          );
        }
        const choice = payload?.choices?.[0];
        const analysis = choice?.message?.content?.trim();
        if (analysis) return NextResponse.json({ analysis });
        lastReason = choice?.finish_reason ?? "unknown";
        console.warn("AI reconciliation: empty Groq answer", {
          model,
          finish_reason: lastReason,
          usage: payload?.usage,
        });
      }
      return NextResponse.json(
        {
          error:
            lastReason === "length"
              ? "The AI ran out of room before answering. Try a shorter date range."
              : "AI returned an empty response. Please try again.",
        },
        { status: 502 },
      );
    }

    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: SYSTEM,
          // Stable instructions cached across checks; the volatile snapshot
          // goes in the user turn after the breakpoint.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
    });

    const analysis = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!analysis) {
      return NextResponse.json({ error: "AI returned an empty response." }, { status: 502 });
    }
    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("POST /api/ai/reconciliation failed", err);
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "Invalid ANTHROPIC_API_KEY." }, { status: 503 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "AI is rate-limited right now. Try again shortly." },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "AI reconciliation failed" }, { status: 500 });
  }
}
