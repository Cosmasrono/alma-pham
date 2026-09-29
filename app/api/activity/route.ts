// Staff absence requests ("Activity"): any signed-in user files a leave
// request or a short excuse (at most two hours); admins approve or decline.
//   GET   → own requests; admins get everyone's.
//   POST  → create a request (validated server-side).
//   PATCH → admin decides a pending request.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { canView, hasPermission, type Role } from "@/lib/auth/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EXCUSE_HOURS = 2; // route files may only export handlers/config

type ActivityRow = Awaited<
  ReturnType<typeof prisma.activityRequest.findFirstOrThrow>
>;

function mapRequest(r: ActivityRow) {
  return {
    id: r.id,
    userId: r.userId,
    userName: r.userName,
    userRole: r.userRole,
    type: r.type,
    reason: r.reason,
    startDate: r.startDate?.toISOString() ?? undefined,
    endDate: r.endDate?.toISOString() ?? undefined,
    excuseDate: r.excuseDate?.toISOString() ?? undefined,
    excuseHours: r.excuseHours ?? undefined,
    excuseStart: r.excuseStart?.toISOString() ?? undefined,
    excuseEnd: r.excuseEnd?.toISOString() ?? undefined,
    status: r.status,
    decidedBy: r.decidedBy ?? undefined,
    decidedAt: r.decidedAt?.toISOString() ?? undefined,
    createdAt: r.createdAt.toISOString(),
  };
}

async function listFor(session: { id: string; role: Role }) {
  const mayViewAll = canView(session.role, "activity.view_all");
  const requests = await prisma.activityRequest.findMany({
    where: mayViewAll ? undefined : { userId: session.id },
    orderBy: { createdAt: "desc" },
  });
  return requests.map(mapRequest);
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ requests: await listFor(session) });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    type?: string;
    reason?: string;
    startDate?: string;
    endDate?: string;
    excuseDate?: string;
    excuseTime?: string; // "HH:mm" — when they leave
    excuseHours?: number;
  };

  const reason = body.reason?.trim() ?? "";
  if (!reason) {
    return NextResponse.json(
      { error: "Please give a reason for the request." },
      { status: 400 },
    );
  }

  let data;
  if (body.type === "leave") {
    const start = body.startDate ? new Date(body.startDate) : null;
    const end = body.endDate ? new Date(body.endDate) : null;
    if (!start || !end || isNaN(+start) || isNaN(+end)) {
      return NextResponse.json(
        { error: "Leave needs a first and last day." },
        { status: 400 },
      );
    }
    if (end < start) {
      return NextResponse.json(
        { error: "Leave cannot end before it starts." },
        { status: 400 },
      );
    }
    data = { type: "leave", startDate: start, endDate: end };
  } else if (body.type === "excuse") {
    const date = body.excuseDate ? new Date(body.excuseDate) : null;
    const hours = Number(body.excuseHours);
    if (!date || isNaN(+date)) {
      return NextResponse.json(
        { error: "The excuse needs a date." },
        { status: 400 },
      );
    }
    if (!/^\d{2}:\d{2}$/.test(body.excuseTime ?? "")) {
      return NextResponse.json(
        { error: "The excuse needs the time you're leaving." },
        { status: 400 },
      );
    }
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_EXCUSE_HOURS) {
      return NextResponse.json(
        { error: `An excuse is at most ${MAX_EXCUSE_HOURS} hours.` },
        { status: 400 },
      );
    }
    // Leaving time + duration fixes the return time; the roster frees the
    // person up automatically once it passes.
    const start = new Date(`${body.excuseDate}T${body.excuseTime}`);
    if (isNaN(+start)) {
      return NextResponse.json(
        { error: "Invalid excuse time." },
        { status: 400 },
      );
    }
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
    data = {
      type: "excuse",
      excuseDate: date,
      excuseHours: hours,
      excuseStart: start,
      excuseEnd: end,
    };
  } else {
    return NextResponse.json(
      { error: "Unknown request type." },
      { status: 400 },
    );
  }

  const isAutoApproved = session.role === "admin" || hasPermission(session.role, "activity.review");

  await prisma.activityRequest.create({
    data: {
      userId: session.id,
      userName: session.name,
      userRole: session.role,
      reason,
      status: isAutoApproved ? "approved" : "pending",
      decidedById: isAutoApproved ? session.id : undefined,
      decidedBy: isAutoApproved ? "Auto-approved (Owner / Admin)" : undefined,
      decidedAt: isAutoApproved ? new Date() : undefined,
      ...data,
    },
  });
  return NextResponse.json({
    requests: await listFor(session),
    autoApproved: isAutoApproved,
  });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.role, "activity.review")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as { id?: string; status?: string };
  if (!body.id || !["approved", "declined"].includes(body.status ?? "")) {
    return NextResponse.json({ error: "Invalid decision." }, { status: 400 });
  }

  const existing = await prisma.activityRequest.findUnique({
    where: { id: body.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  if (existing.status !== "pending") {
    return NextResponse.json(
      { error: "This request was already decided." },
      { status: 409 },
    );
  }

  await prisma.activityRequest.update({
    where: { id: body.id },
    data: {
      status: body.status,
      decidedById: session.id,
      decidedBy: session.name,
      decidedAt: new Date(),
    },
  });
  return NextResponse.json({ requests: await listFor(session) });
}
