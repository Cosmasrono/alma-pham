"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Spinner,
  inputClass,
} from "@/components/ui";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { notify } from "@/lib/toast";
import { useClinic } from "@/lib/store";
import { BRANCHES_ENABLED } from "@/lib/features";

interface StaffUser {
  id: string;
  username: string;
  email: string | null;
  name: string;
  role: Role;
  active: boolean;
  branchId: string | null; // null = every branch (admins) / main (others)
}

// Owner and administrator accounts use approved signup; invite staff here.
const STAFF_ROLES = ROLES.filter((r) => r !== "admin" && r !== "developer");

const emptyForm = {
  name: "",
  username: "",
  email: "",
  role: "receptionist" as Role,
  branchId: "",
};

type UsersApiResponse = {
  users: StaffUser[];
  warning?: string;
};

export default function UsersPage() {
  const { branches } = useClinic();
  const openBranches = branches.filter((b) => b.active);
  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name;
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [userToDelete, setUserToDelete] = useState<StaffUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/users");
      if (alive && res.ok) setUsers((await res.json()).users);
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const message = body.error ?? "Could not create user";
        setError(message);
        notify("error", message);
        return;
      }
      const body = (await res.json()) as UsersApiResponse;
      setUsers(body.users);
      setForm(emptyForm);
      notify("success", "Staff account created.");
      if (body.warning) {
        setError(body.warning);
        notify("error", body.warning);
      } else if (form.email.trim()) {
        notify("success", `Password setup link emailed to ${form.email.trim()}.`);
      }
    } catch {
      setError("The request could not be completed. Refresh the user list before retrying; if the account exists, use Send setup link.");
    } finally {
      setCreating(false);
    }
  };

  const patch = async (id: string, changes: Partial<StaffUser>) => {
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...changes }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      notify("error", body.error ?? "Could not update user.");
      return;
    }
    setUsers((await res.json()).users);
    notify("success", "Staff account updated.");
  };

  const sendSetupLink = async (user: StaffUser) => {
    if (sendingId) return;
    setSendingId(user.id);
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, action: "send-setup-link" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not send the email.");
      notify("success", `Password setup link sent to ${user.email}.`);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not send the email.");
    } finally {
      setSendingId(null);
    }
  };

  const editEmail = async (u: StaffUser) => {
    const email = prompt(
      "Email for password-reset links (leave empty to remove):",
      u.email ?? "",
    );
    if (email !== null) patch(u.id, { email });
  };

  const removeUser = async (u: StaffUser) => {
    setDeleting(true);
    const res = await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      notify("error", body.error ?? "Could not delete user.");
      setDeleting(false);
      return;
    }
    setUsers((await res.json()).users);
    setDeleting(false);
    setUserToDelete(null);
    notify("success", "User deleted.");
  };

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Create staff accounts and assign roles. Only admins see this page."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          {loading ? (
            <EmptyState>
              <span className="inline-flex items-center gap-2">
                <Spinner /> Loading…
              </span>
            </EmptyState>
          ) : users.length === 0 ? (
            <EmptyState>No users yet.</EmptyState>
          ) : (
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Username</th>
                    <th className="px-4 py-2 font-medium">Email</th>
                    <th className="px-4 py-2 font-medium">Role</th>
                    {BRANCHES_ENABLED && <th className="px-4 py-2 font-medium">Branch</th>}
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-zinc-100">
                      <td className="px-4 py-2 font-medium">{u.name}</td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {u.username}
                      </td>
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => editEmail(u)}
                          className="text-left text-xs text-teal-700 hover:underline"
                          title="Edit email"
                        >
                          {u.email ?? <span className="text-zinc-400">Set email</span>}
                        </button>
                      </td>
                      <td className="px-4 py-2">
                        {/* Administrator roles are assigned through approved signup. */}
                        {u.role === "admin" ? (
                          <span className="text-sm font-medium text-teal-900">
                            {ROLE_LABELS.admin}
                          </span>
                        ) : (
                          <select
                            className={`${inputClass} h-8`}
                            value={u.role}
                            onChange={(e) =>
                              patch(u.id, { role: e.target.value as Role })
                            }
                          >
                            {STAFF_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      {BRANCHES_ENABLED && (
                      <td className="px-4 py-2">
                        <select
                          className={`${inputClass} h-8`}
                          value={u.branchId ?? ""}
                          aria-label={`Branch for ${u.name}`}
                          onChange={(e) =>
                            patch(u.id, { branchId: e.target.value } as Partial<StaffUser>)
                          }
                        >
                          <option value="">
                            {u.role === "admin" ? "All branches" : "Main branch (default)"}
                          </option>
                          {openBranches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                          {/* Keep a closed branch visible so the row doesn't lie. */}
                          {u.branchId && !openBranches.some((b) => b.id === u.branchId) && (
                            <option value={u.branchId}>
                              {branchName(u.branchId) ?? "Removed branch"} (closed)
                            </option>
                          )}
                        </select>
                      </td>
                      )}
                      <td className="px-4 py-2">
                        <span
                          className={
                            u.active
                              ? "text-green-700"
                              : "text-zinc-400 line-through"
                          }
                        >
                          {u.active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => sendSetupLink(u)}
                            disabled={!!sendingId || !u.active || !u.email}
                          >
                            {sendingId === u.id ? "Sending…" : "Send setup link"}
                          </Button>
                          <Button
                            size="sm"
                            variant={u.active ? "ghost" : "secondary"}
                            onClick={() => patch(u.id, { active: !u.active })}
                          >
                            {u.active ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setUserToDelete(u)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>

        <Card>
          <h2 className="mb-4 text-sm font-semibold text-zinc-700">
            Add staff member
          </h2>
          <form onSubmit={create} className="flex flex-col gap-4">
            <Field label="Full name">
              <input
                className={inputClass}
                value={form.name}
                onChange={set("name")}
                required
              />
            </Field>
            <Field label="Username">
              <input
                className={inputClass}
                value={form.username}
                onChange={set("username")}
                placeholder="e.g. reception1"
                required
              />
            </Field>
            <Field label="Email (password setup link)">
              <input
                className={inputClass}
                type="email"
                value={form.email}
                onChange={set("email")}
                placeholder="staff@example.com"
                required
              />
            </Field>
            <Field label="Role">
              <select
                className={inputClass}
                value={form.role}
                onChange={set("role")}
              >
                {STAFF_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
            {BRANCHES_ENABLED && (
            <Field label="Branch">
              <select className={inputClass} value={form.branchId} onChange={set("branchId")}>
                <option value="">
                  {form.role === "admin" ? "All branches" : "Main branch (default)"}
                </option>
                {openBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            )}
            <p className="text-xs leading-relaxed text-zinc-500">We will email a link so this staff member can choose their own password and sign in. The link expires in 7 days.</p>
            {error && (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <Button type="submit" disabled={creating}>{creating ? <><Spinner /> Creating & sending…</> : "Create account & send invite"}</Button>
          </form>
        </Card>
      </div>

      {userToDelete && (
        <div
          className="fixed inset-0 z-80 grid place-items-center bg-teal-950/55 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-user-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-600">
              Permanent action
            </p>
            <h2 id="delete-user-title" className="mt-2 text-xl font-semibold text-zinc-900">
              Delete {userToDelete.name}?
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              This removes the staff account and they will no longer be able to sign in. Historical records keep the name already recorded on them.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                onClick={() => setUserToDelete(null)}
                disabled={deleting}
              >
                Keep account
              </Button>
              <Button
                variant="danger"
                onClick={() => removeUser(userToDelete)}
                disabled={deleting}
              >
                {deleting ? <><Spinner /> Deleting…</> : "Delete account"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
