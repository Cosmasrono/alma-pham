"use client";

// Activity: staff request time away — multi-day leave or a short "excuse"
// (at most two hours) — and admins approve or decline the pending ones.

import { useEffect, useState } from "react";
import { hasPermission, ROLE_LABELS, type Role } from "@/lib/auth/roles";
import {
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Spinner,
  cn,
  inputClass,
} from "@/components/ui";
import { useSession } from "@/components/SessionProvider";
import { notify } from "@/lib/toast";

const MAX_EXCUSE_HOURS = 2;

interface ActivityRequest {
  id: string;
  userId: string;
  userName: string;
  userRole: Role;
  type: "leave" | "excuse";
  reason: string;
  startDate?: string;
  endDate?: string;
  excuseDate?: string;
  excuseHours?: number;
  excuseStart?: string;
  excuseEnd?: string;
  status: "pending" | "approved" | "declined";
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
}

const day = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleDateString("en-KE", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

const hm = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-KE", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function requestWhen(r: ActivityRequest): string {
  if (r.type === "leave") {
    return r.startDate === r.endDate
      ? day(r.startDate)
      : `${day(r.startDate)} → ${day(r.endDate)}`;
  }
  if (r.excuseStart && r.excuseEnd) {
    return `${day(r.excuseDate)} · leaves ${hm(r.excuseStart)}, back ${hm(r.excuseEnd)}`;
  }
  const hours =
    r.excuseHours === 1 ? "1 hour" : `${r.excuseHours ?? "?"} hours`;
  return `${day(r.excuseDate)} · ${hours}`;
}

/** Live state of an approved absence: not started yet, away right now, or
 *  lapsed (the person is active/back on the roster again). */
function absenceState(r: ActivityRequest): string | null {
  if (r.status !== "approved") return null;
  const now = new Date();
  if (r.type === "excuse" && r.excuseStart && r.excuseEnd) {
    if (now < new Date(r.excuseStart)) return `away from ${hm(r.excuseStart)}`;
    if (now < new Date(r.excuseEnd)) return `away now · back ${hm(r.excuseEnd)}`;
    return "back — active";
  }
  if (r.type === "leave" && r.startDate && r.endDate) {
    const dayMs = 24 * 60 * 60 * 1000;
    if (now < new Date(r.startDate)) return "upcoming";
    if (now < new Date(new Date(r.endDate).getTime() + dayMs)) {
      return "away now";
    }
    return "back — active";
  }
  return null;
}

const STATUS_STYLE: Record<ActivityRequest["status"], string> = {
  pending: "bg-amber-50 text-amber-800 ring-amber-600/20",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  declined: "bg-red-50 text-red-700 ring-red-600/25",
};

function RequestStatus({ status }: { status: ActivityRequest["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset",
        STATUS_STYLE[status],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
      {status}
    </span>
  );
}

export default function ActivityPage() {
  const session = useSession();
  const [requests, setRequests] = useState<ActivityRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/activity");
        if (alive && res.ok) {
          setRequests(((await res.json()) as { requests: ActivityRequest[] }).requests);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const isAdmin = session ? hasPermission(session.role, "activity.review") : false;
  const mine = requests.filter((r) => r.userId === session?.id);
  const pendingOthers = requests.filter(
    (r) => r.status === "pending" && r.userId !== session?.id,
  );

  return (
    <div>
      <PageHeader
        title="Activity"
        subtitle={
          isAdmin
            ? "Approve or decline staff leave and short excuses, and file your own"
            : "Request leave or a short excuse (up to 2 hours) — the admin reviews it"
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          {isAdmin && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-zinc-700">
                Awaiting your approval
                {pendingOthers.length > 0 && ` (${pendingOthers.length})`}
              </h2>
              {loading ? (
                <EmptyState>
                  <span className="inline-flex items-center gap-2">
                    <Spinner /> Loading…
                  </span>
                </EmptyState>
              ) : pendingOthers.length === 0 ? (
                <EmptyState>No requests waiting for a decision.</EmptyState>
              ) : (
                <div className="flex flex-col gap-3">
                  {pendingOthers.map((r) => (
                    <ApprovalCard key={r.id} request={r} onDecided={setRequests} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* The permanent log: every request ever filed stays here with its
              status. Admins see the whole clinic's; staff see their own. */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-zinc-700">
              {isAdmin ? "All activity" : "My requests"}
            </h2>
            {loading ? (
              <EmptyState>
                <span className="inline-flex items-center gap-2">
                  <Spinner /> Loading…
                </span>
              </EmptyState>
            ) : (isAdmin ? requests : mine).length === 0 ? (
              <EmptyState>
                Nothing yet — file your first request on the right.
              </EmptyState>
            ) : (
              <RequestTable
                requests={isAdmin ? requests : mine}
                showUser={isAdmin}
              />
            )}
          </section>
        </div>

        <RequestForm onCreated={setRequests} />
      </div>
    </div>
  );
}

function RequestTable({
  requests,
  showUser,
}: {
  requests: ActivityRequest[];
  showUser: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-teal-950/[0.07] bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              {showUser && <th className="px-4 py-2.5 font-medium">Staff</th>}
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">When</th>
              <th className="px-4 py-2.5 font-medium">Reason</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100">
                {showUser && (
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-zinc-800">{r.userName}</p>
                    <p className="text-xs text-zinc-500">
                      {ROLE_LABELS[r.userRole] ?? r.userRole}
                    </p>
                  </td>
                )}
                <td className="px-4 py-2.5 capitalize text-zinc-700">
                  {r.type}
                </td>
                <td className="px-4 py-2.5 text-zinc-600">{requestWhen(r)}</td>
                <td className="max-w-56 px-4 py-2.5 text-zinc-600">
                  <span className="line-clamp-2">{r.reason}</span>
                </td>
                <td className="px-4 py-2.5">
                  <RequestStatus status={r.status} />
                  {absenceState(r) && (
                    <p className="mt-1 text-[11px] font-medium text-teal-700">
                      {absenceState(r)}
                    </p>
                  )}
                  {r.decidedBy && (
                    <p className="mt-1 text-[11px] text-zinc-400">
                      by {r.decidedBy}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ApprovalCard({
  request,
  onDecided,
}: {
  request: ActivityRequest;
  onDecided: (requests: ActivityRequest[]) => void;
}) {
  const [busy, setBusy] = useState(false);

  const decide = async (status: "approved" | "declined") => {
    setBusy(true);
    try {
      const res = await fetch("/api/activity", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: request.id, status }),
      });
      const body = (await res.json()) as {
        requests?: ActivityRequest[];
        error?: string;
      };
      if (!res.ok || !body.requests) {
        notify("error", body.error ?? "Could not save the decision.");
        return;
      }
      onDecided(body.requests);
      notify(
        "success",
        `${request.userName}'s ${request.type} ${status}.`,
      );
    } catch {
      notify("error", "Network error — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium text-zinc-800">
          {request.userName}
          <span className="ml-2 text-xs font-normal text-zinc-500">
            {ROLE_LABELS[request.userRole] ?? request.userRole}
          </span>
        </p>
        <p className="mt-0.5 text-sm text-zinc-600">
          <span className="capitalize">{request.type}</span> ·{" "}
          {requestWhen(request)}
        </p>
        <p className="mt-1 text-sm text-zinc-500">“{request.reason}”</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" disabled={busy} onClick={() => decide("approved")}>
          Approve
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={() => decide("declined")}
        >
          Decline
        </Button>
      </div>
    </Card>
  );
}

const emptyForm = {
  type: "leave" as "leave" | "excuse",
  reason: "",
  startDate: "",
  endDate: "",
  excuseDate: "",
  excuseTime: "",
  excuseHours: "1",
};

function RequestForm({
  onCreated,
}: {
  onCreated: (requests: ActivityRequest[]) => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof emptyForm) => (e: {
    target: { value: string };
  }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload =
        form.type === "leave"
          ? {
              type: "leave",
              reason: form.reason,
              startDate: form.startDate,
              endDate: form.endDate,
            }
          : {
              type: "excuse",
              reason: form.reason,
              excuseDate: form.excuseDate,
              excuseTime: form.excuseTime,
              excuseHours: Number(form.excuseHours),
            };
      const res = await fetch("/api/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as {
        requests?: ActivityRequest[];
        autoApproved?: boolean;
        error?: string;
      };
      if (!res.ok || !body.requests) {
        const message = body.error ?? "Could not send the request.";
        setError(message);
        notify("error", message);
        return;
      }
      onCreated(body.requests);
      setForm(emptyForm);
      if (body.autoApproved) {
        notify("success", "Leave/excuse submitted and auto-approved.");
      } else {
        notify("success", "Request sent to the admin for approval.");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="self-start">
      <h2 className="mb-4 text-sm font-semibold text-zinc-700">New request</h2>

      <div className="mb-4 flex gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1">
        {(
          [
            { id: "leave", label: "Leave" },
            { id: "excuse", label: `Excuse (≤ ${MAX_EXCUSE_HOURS}h)` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setForm((f) => ({ ...f, type: t.id }))}
            className={cn(
              "flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors",
              form.type === t.id
                ? "bg-white text-teal-900 shadow-sm"
                : "text-zinc-500 hover:text-zinc-700",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        {form.type === "leave" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="First day">
              <input
                className={inputClass}
                type="date"
                value={form.startDate}
                onChange={set("startDate")}
                required
              />
            </Field>
            <Field label="Last day">
              <input
                className={inputClass}
                type="date"
                value={form.endDate}
                onChange={set("endDate")}
                required
              />
            </Field>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <input
                  className={inputClass}
                  type="date"
                  value={form.excuseDate}
                  onChange={set("excuseDate")}
                  required
                />
              </Field>
              <Field label="Leaving at">
                <input
                  className={inputClass}
                  type="time"
                  value={form.excuseTime}
                  onChange={set("excuseTime")}
                  required
                />
              </Field>
            </div>
            <Field label={`Hours away (max ${MAX_EXCUSE_HOURS} — 0.5 = 30 min)`}>
              <input
                className={inputClass}
                type="number"
                min={0.5}
                max={MAX_EXCUSE_HOURS}
                step={0.5}
                value={form.excuseHours}
                onChange={set("excuseHours")}
                required
              />
            </Field>
            {form.excuseTime && Number(form.excuseHours) > 0 && (
              <p className="-mt-2 text-xs text-teal-700">
                Expected back at{" "}
                {hm(
                  new Date(
                    new Date(
                      `${form.excuseDate || "2000-01-01"}T${form.excuseTime}`,
                    ).getTime() +
                      Number(form.excuseHours) * 60 * 60 * 1000,
                  ).toISOString(),
                )}
              </p>
            )}
          </>
        )}

        <Field label="Reason">
          <textarea
            className={cn(inputClass, "h-24 resize-none py-2")}
            value={form.reason}
            onChange={set("reason")}
            placeholder={
              form.type === "leave"
                ? "e.g. Annual leave — family visit"
                : "e.g. Bank appointment, back by 11:30"
            }
            required
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {busy ? "Sending…" : "Send for approval"}
        </Button>
      </form>
    </Card>
  );
}
