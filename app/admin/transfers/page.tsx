"use client";

// Move stock between branches. Batches travel with their batch number and
// expiry date (earliest-expiring first), so expiry tracking stays exact at the
// receiving branch. Branch staff send from their own branch; admins pick.

import { useMemo, useState } from "react";
import { transferStock, useClinic } from "@/lib/store";
import { Button, Card, EmptyState, Field, PageHeader, inputClass } from "@/components/ui";
import { medicineLabel } from "@/components/SaleReceipt";

export default function TransfersPage() {
  const data = useClinic();
  const active = data.branches.filter((b) => b.active);
  const branchName = useMemo(
    () => new Map(data.branches.map((b) => [b.id, b.name])),
    [data.branches],
  );
  const medicines = useMemo(() => new Map(data.medicines.map((m) => [m.id, m])), [data.medicines]);

  // Staff always send from their own branch; admins default to the one in view.
  const fixedFrom = data.canSwitchBranch ? null : data.viewBranchId;
  const [fromBranchId, setFromBranchId] = useState<string>(data.viewBranchId ?? "");
  const from = fixedFrom ?? fromBranchId;
  const [toBranchId, setToBranchId] = useState("");
  const [query, setQuery] = useState("");
  const [medicineId, setMedicineId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const matches = q
    ? data.medicines
        .filter((m) => `${m.name} ${m.strength} ${m.genericName ?? ""}`.toLowerCase().includes(q))
        .slice(0, 8)
    : [];
  const chosen = medicineId ? medicines.get(medicineId) : undefined;
  // In one branch's view, the medicine's stock is that branch's shelf.
  const showsFromStock = data.viewBranchId !== null && data.viewBranchId === from;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    const err = await transferStock({
      medicineId,
      fromBranchId: from,
      toBranchId,
      quantity: Number(quantity),
      notes,
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setDone(
      `${quantity} × ${chosen ? medicineLabel(chosen) : "item"} sent to ${branchName.get(toBranchId) ?? "branch"}.`,
    );
    setQuantity("");
    setNotes("");
  };

  if (active.length < 2) {
    return (
      <div>
        <PageHeader title="Stock transfers" subtitle="Move stock between branches" />
        <EmptyState>
          You need at least two open branches to transfer stock. Add one under Branches.
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Stock transfers"
        subtitle="Move stock between branches — batches keep their expiry dates"
      />
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Field label="From branch">
              <select
                className={inputClass}
                value={from}
                disabled={!!fixedFrom}
                onChange={(e) => setFromBranchId(e.target.value)}
                required
              >
                <option value="">Choose…</option>
                {active.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="To branch">
              <select
                className={inputClass}
                value={toBranchId}
                onChange={(e) => setToBranchId(e.target.value)}
                required
              >
                <option value="">Choose…</option>
                {active
                  .filter((b) => b.id !== from)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Medicine">
              {chosen ? (
                <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm">
                  <span>
                    <strong>{medicineLabel(chosen)}</strong>
                    {showsFromStock && (
                      <span className="ml-1 text-xs text-zinc-500">· {chosen.stock} here</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-teal-700 underline"
                    onClick={() => setMedicineId("")}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className={inputClass}
                    placeholder="Search the catalog…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {matches.length > 0 && (
                    <ul className="mt-1 divide-y divide-zinc-100 rounded-lg border border-zinc-200 text-sm">
                      {matches.map((m) => (
                        <li key={m.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left hover:bg-teal-50"
                            onClick={() => {
                              setMedicineId(m.id);
                              setQuery("");
                            }}
                          >
                            {medicineLabel(m)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Field>
            <Field label="Units to send">
              <input
                className={inputClass}
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </Field>
            <Field label="Notes (optional)">
              <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
            {done && <p className="rounded-lg bg-teal-50 p-2 text-xs text-teal-800">{done}</p>}
            <Button type="submit" disabled={busy || !from || !toBranchId || !medicineId || !quantity}>
              {busy ? "Sending…" : "Send stock"}
            </Button>
          </form>
        </Card>

        <Card className="p-0">
          <h2 className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-700">
            Recent transfers
          </h2>
          {(data.transfers ?? []).length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-400">No transfers yet.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 text-zinc-500">
                <tr>
                  <th className="py-2 pl-4 font-semibold">When</th>
                  <th className="py-2 font-semibold">Medicine</th>
                  <th className="py-2 font-semibold">From → To</th>
                  <th className="py-2 text-right font-semibold">Units</th>
                  <th className="py-2 pl-3 pr-4 font-semibold">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {(data.transfers ?? []).map((t) => {
                  const m = medicines.get(t.medicineId);
                  return (
                    <tr key={t.id}>
                      <td className="py-2 pl-4 text-zinc-500">
                        {new Date(t.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 font-medium text-zinc-800">
                        {m ? medicineLabel(m) : "Removed medicine"}
                      </td>
                      <td className="py-2 text-zinc-600">
                        {branchName.get(t.fromBranchId) ?? "?"} → {branchName.get(t.toBranchId) ?? "?"}
                      </td>
                      <td className="py-2 text-right font-semibold tabular-nums">{t.quantity}</td>
                      <td className="py-2 pl-3 pr-4 text-zinc-500">{t.byName ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
