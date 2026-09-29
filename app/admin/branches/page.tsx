"use client";

// Branch management: every clinic location, its code and contact details.
// Staff are assigned to a branch under Users; stock moves between branches
// under Stock transfers.

import { useEffect, useState } from "react";
import { refresh } from "@/lib/store";
import type { Branch } from "@/lib/types";
import { Button, Card, Field, PageHeader, cn, inputClass } from "@/components/ui";

const blank = { name: "", code: "", address: "", phone: "" };

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/branches")
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as { branches?: Branch[] };
      })
      .then((b) => setBranches(b.branches ?? []))
      .catch(() => setError("Could not load branches."));
  }, []);

  const send = async (method: "POST" | "PATCH", body: object) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/branches", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // A server crash can come back with an empty body — don't let that
      // become a second, confusing error.
      const data = (await res.json().catch(() => ({}))) as { branches?: Branch[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? `The server couldn't save that (error ${res.status}). Try again.`);
        return false;
      }
      setBranches(data.branches ?? []);
      void refresh(); // the sidebar's branch switcher lists them too
      return true;
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await send("POST", form)) setForm(blank);
  };

  return (
    <div>
      <PageHeader
        title="Branches"
        subtitle="Each branch has its own reception queue, doctors, lab, pharmacy stock and tills. Patients are shared."
      />
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="py-2.5 pl-4 font-semibold">Branch</th>
                <th className="py-2.5 font-semibold">Code</th>
                <th className="py-2.5 font-semibold">Contact</th>
                <th className="py-2.5 pr-4 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {branches.map((b) => (
                <tr key={b.id} className={cn(!b.active && "opacity-50")}>
                  <td className="py-3 pl-4">
                    <span className="font-semibold text-zinc-900">{b.name}</span>
                    {b.isMain && (
                      <span className="ml-2 rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-800">
                        Main
                      </span>
                    )}
                    {!b.active && (
                      <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-bold text-zinc-600">
                        Closed
                      </span>
                    )}
                  </td>
                  <td className="py-3 font-mono text-xs text-zinc-600">{b.code}</td>
                  <td className="py-3 text-xs text-zinc-500">
                    {[b.address, b.phone].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="space-x-2 py-3 pr-4 text-right text-xs">
                    <button className="text-teal-700 underline" onClick={() => setEditing(b)}>
                      Edit
                    </button>
                    {!b.isMain && b.active && (
                      <button
                        className="text-teal-700 underline"
                        disabled={busy}
                        onClick={() =>
                          confirm(`Make ${b.name} the main branch?`) &&
                          void send("PATCH", { id: b.id, isMain: true })
                        }
                      >
                        Make main
                      </button>
                    )}
                    {!b.isMain && (
                      <button
                        className={b.active ? "text-rose-700 underline" : "text-teal-700 underline"}
                        disabled={busy}
                        onClick={() =>
                          (b.active
                            ? confirm(
                                `Close ${b.name}? Its staff will be moved to the main branch's screens until they're reassigned.`,
                              )
                            : true) && void send("PATCH", { id: b.id, active: !b.active })
                        }
                      >
                        {b.active ? "Close" : "Reopen"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {branches.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-zinc-400">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-bold text-zinc-800">Add a branch</h2>
          <form onSubmit={create} className="flex flex-col gap-3">
            <Field label="Name">
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Westlands"
                required
              />
            </Field>
            <Field label="Code">
              <input
                className={cn(inputClass, "uppercase")}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. WSTL"
                required
              />
            </Field>
            <Field label="Address (optional)">
              <input
                className={inputClass}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>
            <Field label="Phone (optional)">
              <input
                className={inputClass}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Add branch"}
            </Button>
          </form>
          <p className="mt-3 text-xs text-zinc-500">
            A new branch starts with no stock. Send it stock under Stock transfers, or receive
            deliveries there directly.
          </p>
        </Card>
      </div>

      {editing && (
        <EditBranch
          branch={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (changes) => {
            if (await send("PATCH", { id: editing.id, ...changes })) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function EditBranch({
  branch,
  busy,
  onClose,
  onSave,
}: {
  branch: Branch;
  busy: boolean;
  onClose: () => void;
  onSave: (changes: Partial<Branch>) => void;
}) {
  const [name, setName] = useState(branch.name);
  const [code, setCode] = useState(branch.code);
  const [address, setAddress] = useState(branch.address ?? "");
  const [phone, setPhone] = useState(branch.phone ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Edit {branch.name}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Code">
            <input
              className={cn(inputClass, "uppercase")}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field label="Address">
            <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Button disabled={busy} onClick={() => onSave({ name, code, address, phone })}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
