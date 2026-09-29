"use client";

// The developer console — the software vendor's view of a clinic's system.
// It shows everything (branches, accounts, money, stock and till alerts,
// integrations) and offers only on/off switches: the whole system, a branch,
// a branch's staff, or a single account. Clinic data can't be changed here or
// anywhere else from this account.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { switchBranch } from "@/lib/store";
import { Button, Card, PageHeader, cn, inputClass } from "@/components/ui";
import { compactMoney, money, pctChange } from "@/lib/analytics";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import type { BranchStats } from "@/lib/server/branch-stats";
import { BRANCHES_ENABLED } from "@/lib/features";

interface ConsoleData {
  system: { locked: boolean; message: string | null; rawMessage: string | null };
  integrations: { database: boolean; mpesa: boolean; ai: boolean; email: boolean };
  totals: {
    branches: number;
    activeBranches: number;
    staff: number;
    activeStaff: number;
    admins: number;
    patients: number;
    revenueToday: number;
    revenue30: number;
    revenuePrev30: number;
    inHouse30: number;
    community30: number;
    visits30: number;
    openNow: number;
    stockValue: number;
    openTills: number;
  };
  staffByRole: { role: string; label: string; count: number }[];
  branches: {
    id: string;
    name: string;
    code: string;
    isMain: boolean;
    active: boolean;
    stats: BranchStats | null;
    revenueToday: number;
    assigned: number;
    assignedActive: number;
  }[];
  users: {
    id: string;
    name: string;
    username: string;
    email: string | null;
    role: string;
    active: boolean;
    branchId: string | null;
  }[];
}

async function fetchConsole(): Promise<{ data?: ConsoleData; error?: string }> {
  try {
    const res = await fetch("/api/developer", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    return res.ok ? { data: body as ConsoleData } : { error: body.error ?? "Could not load the console." };
  } catch {
    return { error: "Could not load the console." };
  }
}

export default function DeveloperConsolePage() {
  const router = useRouter();
  const [data, setData] = useState<ConsoleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [userQuery, setUserQuery] = useState("");

  const load = useCallback(async () => {
    const r = await fetchConsole();
    if (r.data) {
      setData(r.data);
      setError(null);
    } else setError(r.error ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchConsole().then((r) => {
      if (cancelled) return;
      if (r.data) setData(r.data);
      else setError(r.error ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Flip one switch, then reload the console. */
  const toggle = async (key: string, body: object, done: string) => {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fetch("/api/developer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(r.error ?? "That didn't work.");
        return;
      }
      setError(null);
      setNotice(done);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const view = async (id: string) => {
    setBusy(`open-${id}`);
    await switchBranch(id);
    setBusy(null);
    router.push("/dashboard");
  };

  const users = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    const list = data?.users ?? [];
    return q
      ? list.filter((u) => `${u.name} ${u.username} ${u.email ?? ""} ${u.role}`.toLowerCase().includes(q))
      : list;
  }, [data, userQuery]);

  if (!data) {
    return (
      <div>
        <PageHeader title="Developer console" subtitle="The whole system at a glance" />
        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : (
          <p className="rounded-2xl bg-white/70 p-8 text-center text-sm text-zinc-400">Loading…</p>
        )}
      </div>
    );
  }

  const t = data.totals;
  const delta = pctChange(t.revenue30, t.revenuePrev30);
  const branchName = (id: string | null) =>
    data.branches.find((b) => b.id === id)?.name ?? (id ? "Removed branch" : "Main / all");
  const communityShare = t.revenue30 > 0 ? t.community30 / t.revenue30 : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Developer console"
        subtitle="See the whole system. The only changes possible from here are on/off switches."
      />

      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "rounded-full px-3 py-1 text-xs font-bold",
            data.system.locked ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800",
          )}
        >
          {data.system.locked ? "● System locked for all clinic staff" : "● System running"}
        </span>
        <button
          onClick={() => void load()}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          Refresh
        </button>
        {notice && <span className="text-xs text-teal-700">{notice}</span>}
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {BRANCHES_ENABLED ? (
          <Tile label="Branches" value={`${t.activeBranches}`} hint={`${t.branches} total · ${t.branches - t.activeBranches} closed`} />
        ) : (
          <Tile label="Stock on shelves" value={compactMoney(t.stockValue)} hint="At selling price" />
        )}
        <Tile label="Staff accounts" value={`${t.activeStaff}`} hint={`${t.staff} total · ${t.admins} active admin${t.admins === 1 ? "" : "s"}`} />
        <Tile label="Registered patients" value={t.patients.toLocaleString("en-KE")} hint="Shared by all branches" />
        <Tile label="In clinic now" value={`${t.openNow}`} hint={`${t.openTills} till${t.openTills === 1 ? "" : "s"} open`} />
        <Tile label="Revenue today" value={compactMoney(t.revenueToday)} hint="All branches" />
        <Tile
          label="Revenue · 30 days"
          value={compactMoney(t.revenue30)}
          hint={delta === null ? "No earlier period" : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(delta))}% vs previous 30 days`}
          tone={delta === null ? undefined : delta >= 0 ? "good" : "bad"}
        />
        <Tile label="Visits · 30 days" value={t.visits30.toLocaleString("en-KE")} hint="Clinic patients checked in" />
        {BRANCHES_ENABLED ? (
          <Tile label="Stock on shelves" value={compactMoney(t.stockValue)} hint="At selling price" />
        ) : (
          <Tile label="Open tills" value={`${t.openTills}`} hint="Cashier sessions running" />
        )}
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-semibold text-zinc-800">Where the money came from · 30 days</span>
          <span className="text-xs text-zinc-500">
            In-house {money(t.inHouse30)} · Community {money(t.community30)}
          </span>
        </div>
        <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
          <div className="bg-sky-500" style={{ width: `${(1 - communityShare) * 100}%` }} />
          <div className="bg-violet-500" style={{ width: `${communityShare * 100}%` }} />
        </div>
      </Card>

      {/* --- branches (hidden while branches are switched off) ------------------ */}
      {BRANCHES_ENABLED && (
      <Card className="p-0">
        <h2 className="border-b border-zinc-100 px-4 py-3 text-sm font-bold text-zinc-800">
          Branches ({data.branches.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="py-2.5 pl-4 font-semibold">Branch</th>
                <th className="py-2.5 text-right font-semibold">Today</th>
                <th className="py-2.5 text-right font-semibold">30 days</th>
                <th className="py-2.5 text-right font-semibold">Visits</th>
                <th className="py-2.5 text-right font-semibold">Staff on</th>
                <th className="py-2.5 pl-4 font-semibold">Needs attention</th>
                <th className="py-2.5 pr-4 text-right font-semibold">Switches</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {data.branches.map((b) => {
                const s = b.stats;
                const d = s ? pctChange(s.revenue, s.previousRevenue) : null;
                const issues = s
                  ? [
                      s.tills.discrepancies > 0 && `${s.tills.discrepancies} till discrepanc${s.tills.discrepancies === 1 ? "y" : "ies"}`,
                      s.stock.expiredUnits > 0 && `${s.stock.expiredUnits} expired units`,
                      s.stock.outOfStock > 0 && `${s.stock.outOfStock} out of stock`,
                      s.stock.lowStock > 0 && `${s.stock.lowStock} low`,
                    ].filter(Boolean)
                  : [];
                const staffOn = b.assignedActive === b.assigned;
                return (
                  <tr key={b.id} className={cn(!b.active && "bg-zinc-50/70")}>
                    <td className="py-3 pl-4">
                      <span className="font-semibold text-zinc-900">{b.name}</span>
                      <span className="ml-2 font-mono text-[10px] text-zinc-400">{b.code}</span>
                      {b.isMain && (
                        <span className="ml-2 rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-800">Main</span>
                      )}
                      {!b.active && (
                        <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-bold text-zinc-600">Off</span>
                      )}
                      {s && s.openNow > 0 && <span className="ml-2 text-[11px] text-teal-700">{s.openNow} in clinic</span>}
                    </td>
                    <td className="py-3 text-right tabular-nums">{money(b.revenueToday)}</td>
                    <td className="py-3 text-right tabular-nums">
                      {money(s?.revenue ?? 0)}
                      {d !== null && (
                        <span className={cn("ml-1 text-[11px]", d >= 0 ? "text-emerald-700" : "text-rose-700")}>
                          {d >= 0 ? "▲" : "▼"}
                          {Math.abs(Math.round(d))}%
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-right tabular-nums">{s?.visits ?? 0}</td>
                    <td className="py-3 text-right tabular-nums">
                      {b.assignedActive}/{b.assigned}
                    </td>
                    <td className="py-3 pl-4 text-xs">
                      {issues.length ? (
                        <span className="text-amber-800">{issues.join(" · ")}</span>
                      ) : (
                        <span className="text-emerald-700">All good</span>
                      )}
                    </td>
                    <td className="space-x-2 whitespace-nowrap py-3 pr-4 text-right text-xs">
                      {b.active && (
                        <button className="font-semibold text-teal-700 underline" disabled={busy !== null} onClick={() => void view(b.id)}>
                          {busy === `open-${b.id}` ? "Opening…" : "View"}
                        </button>
                      )}
                      {b.assigned > 0 && (
                        <button
                          className="text-teal-700 underline"
                          disabled={busy !== null}
                          onClick={() =>
                            confirm(
                              staffOn
                                ? `Switch OFF all ${b.assigned} staff accounts at ${b.name}? They won't be able to sign in.`
                                : `Switch ON all staff accounts at ${b.name}?`,
                            ) &&
                            void toggle(
                              `staff-${b.id}`,
                              { action: "setBranchStaffActive", branchId: b.id, active: !staffOn },
                              staffOn ? `${b.name} staff switched off.` : `${b.name} staff switched on.`,
                            )
                          }
                        >
                          {staffOn ? "Staff off" : "Staff on"}
                        </button>
                      )}
                      {!b.isMain && (
                        <button
                          className={b.active ? "text-rose-700 underline" : "font-semibold text-emerald-700 underline"}
                          disabled={busy !== null}
                          onClick={() =>
                            (b.active
                              ? confirm(`Switch ${b.name} off? It leaves the branch switcher and its staff work from the main branch. Its records are kept.`)
                              : true) &&
                            void toggle(
                              `branch-${b.id}`,
                              { action: "setBranchActive", branchId: b.id, active: !b.active },
                              b.active ? `${b.name} switched off.` : `${b.name} switched on.`,
                            )
                          }
                        >
                          {b.active ? "Switch off" : "Switch on"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <SystemLockCard
          locked={data.system.locked}
          message={data.system.rawMessage ?? ""}
          busy={busy === "lock"}
          onChange={(locked, message) =>
            void toggle(
              "lock",
              { action: "setSystemLock", locked, message },
              locked ? "System locked for all clinic staff." : "System unlocked.",
            )
          }
        />

        <Card>
          <h2 className="text-sm font-bold text-zinc-800">Connections</h2>
          <p className="text-xs text-zinc-500">What this server is plugged into.</p>
          <ul className="mt-3 space-y-2 text-sm">
            <Integration name="Database" ok={data.integrations.database} okText="Connected" badText="Not reachable" />
            <Integration name="M-Pesa (PayHero)" ok={data.integrations.mpesa} okText="Phone prompts on" badText="Not set up — codes are typed in" />
            <Integration name="AI (insights & assistant)" ok={data.integrations.ai} okText="Configured" badText="No AI key in .env" />
            <Integration name="Email (password links)" ok={data.integrations.email} okText="Configured" badText="Not set up" />
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            {data.staffByRole.map((r) => (
              <span key={r.role} className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700">
                {r.label}: <strong>{r.count}</strong>
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-bold text-zinc-800">Accounts ({data.users.length})</h2>
          <div className="flex items-center gap-3">
            <input
              className={cn(inputClass, "h-8 w-56 text-xs")}
              placeholder="Search name, username, role…"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
            />
            <Link href="/admin/users" className="text-xs font-semibold text-teal-700 underline">
              Full user list
            </Link>
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="py-2 pl-4 font-semibold">Name</th>
                <th className="py-2 font-semibold">Role</th>
                {BRANCHES_ENABLED && <th className="py-2 font-semibold">Branch</th>}
                <th className="py-2 pr-4 text-right font-semibold">Account</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {users.map((u) => {
                const lastAdmin = u.role === "admin" && u.active && t.admins <= 1;
                return (
                  <tr key={u.id} className={cn(!u.active && "bg-zinc-50/70 text-zinc-400")}>
                    <td className="py-2 pl-4">
                      <span className="font-medium">{u.name}</span>
                      <span className="ml-2 font-mono text-[11px] text-zinc-400">{u.username}</span>
                    </td>
                    <td className="py-2 text-xs">{ROLE_LABELS[u.role as Role] ?? u.role}</td>
                    {BRANCHES_ENABLED && <td className="py-2 text-xs">{branchName(u.branchId)}</td>}
                    <td className="py-2 pr-4 text-right text-xs">
                      <button
                        className={u.active ? "text-rose-700 underline" : "font-semibold text-emerald-700 underline"}
                        disabled={busy !== null}
                        onClick={() =>
                          (u.active
                            ? confirm(
                                lastAdmin
                                  ? `${u.name} is the clinic's only active admin. Switching them off leaves nobody able to manage the clinic. Continue?`
                                  : `Switch off ${u.name}'s account? They won't be able to sign in.`,
                              )
                            : true) &&
                          void toggle(
                            `user-${u.id}`,
                            { action: "setUserActive", userId: u.id, active: !u.active },
                            u.active ? `${u.name} switched off.` : `${u.name} switched on.`,
                          )
                        }
                      >
                        {u.active ? "Switch off" : "Switch on"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-xs text-zinc-400">
                    No accounts match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-2xl border border-teal-950/[0.07] bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">{value}</p>
      {hint && (
        <p className={cn("mt-0.5 text-xs", tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-700" : "text-zinc-500")}>
          {hint}
        </p>
      )}
    </div>
  );
}

function Integration({ name, ok, okText, badText }: { name: string; ok: boolean; okText: string; badText: string }) {
  return (
    <li className="flex items-start justify-between gap-3">
      <span className="font-medium text-zinc-800">{name}</span>
      <span className={cn("text-right text-xs", ok ? "text-emerald-700" : "text-amber-700")}>
        {ok ? "✓ " : "⚠ "}
        {ok ? okText : badText}
      </span>
    </li>
  );
}

/** The master switch: turn the whole system off for every clinic account
 *  (maintenance, unpaid subscription, a security problem) with a message. */
function SystemLockCard({
  locked,
  message,
  busy,
  onChange,
}: {
  locked: boolean;
  message: string;
  busy: boolean;
  onChange: (locked: boolean, message: string) => void;
}) {
  const [draft, setDraft] = useState(message);
  return (
    <Card className={cn(locked && "border-rose-300 bg-rose-50/40")}>
      <h2 className="text-sm font-bold text-zinc-800">System on / off</h2>
      <p className="text-xs text-zinc-500">
        Switching the system off blocks every clinic account — admins included — until you switch
        it back on. Nothing is deleted.
      </p>
      <textarea
        className={cn(inputClass, "mt-3 text-xs")}
        rows={2}
        placeholder="Message staff will see, e.g. “Subscription renewal due — contact your provider.”"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="mt-2 flex gap-2">
        {locked ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => onChange(false, draft)}>
              {busy ? "Switching on…" : "Switch system on"}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onChange(true, draft)}>
              Update message
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              confirm("Switch the system off? Every clinic account will be locked out until you switch it back on.") &&
              onChange(true, draft)
            }
          >
            {busy ? "Switching off…" : "Switch system off"}
          </Button>
        )}
      </div>
    </Card>
  );
}
