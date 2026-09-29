"use client";

import { useState } from "react";
import { completeServiceOrder, startServiceOrder, useClinic } from "@/lib/store";
import type { LabParameter, Order, OrderType } from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  inputClass,
} from "@/components/ui";
import { openServiceOrders, patientName } from "@/lib/selectors";
import { useSession } from "@/components/SessionProvider";

type Filter = "all" | Exclude<OrderType, "prescription">;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "lab", label: "Lab" },
  { key: "radiology", label: "Radiology" },
  { key: "procedure", label: "Procedures" },
];

export default function ServicesPage() {
  const data = useClinic();
  const session = useSession();
  // Technicians land on their own department; everyone can still switch tabs.
  const [filter, setFilter] = useState<Filter>(
    session?.role === "lab" || session?.role === "radiology"
      ? session.role
      : "all",
  );
  const items = openServiceOrders(
    data,
    filter === "all" ? undefined : filter,
  );

  return (
    <div>
      <PageHeader
        title="Lab / Radiology / Procedures"
        subtitle="Complete only the tests requested by the doctor, then return the patient for review."
      />

      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f.key
                ? "bg-teal-600 text-white"
                : "bg-white text-zinc-600 border border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState>No outstanding orders in this department.</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map(({ order, patient }) => (
            <ResultCard
              key={order.id}
              order={order}
              // Labs report against the catalog's parameter panel; radiology
              // and procedures report a free-text finding.
              parameters={
                data.serviceCatalog.find((s) => s.id === order.serviceItemId)
                  ?.parameters ?? []
              }
              patient={patientName(patient)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultCard({
  order,
  parameters,
  patient,
}: {
  order: Order;
  parameters: LabParameter[];
  patient: string;
}) {
  // Panel entry keyed by parameter name; free-text for everything else.
  const [values, setValues] = useState<Record<string, string>>({});
  const [freeText, setFreeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const status = order.status;
  const locked = status === "requested";
  const panel = parameters.length > 0;
  const completedFields = panel
    ? parameters.filter((p) => values[p.name]?.trim()).length
    : freeText.trim()
      ? 1
      : 0;
  const filled = panel
    ? parameters.every((p) => values[p.name]?.trim())
    : freeText.trim() !== "";

  const file = async () => {
    setBusy(true);
    await completeServiceOrder(
      order.id,
      panel
        ? {
            results: parameters.map((p) => ({
              parameter: p.name,
              value: values[p.name]?.trim() ?? "",
            })),
            // A panel can still carry an overall comment.
            result: freeText.trim() || undefined,
          }
        : { result: freeText },
    );
    setBusy(false);
  };

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-teal-700">
            Doctor requested
          </p>
          <p className="font-medium">{order.title}</p>
          <p className="text-xs text-zinc-500">
            {patient} · <span className="capitalize">{order.type}</span>
          </p>
        </div>
        <StatusBadge status={status} />
      </div>
      {order.instructions && (
        <div className="mt-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
          <span className="font-medium">Doctor&apos;s note:</span>{" "}
          {order.instructions}
        </div>
      )}
      {locked && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Step 1</p>
          <p className="mt-1 text-sm text-amber-900">Confirm that the sample or patient has been received before entering findings.</p>
        <Button
          className="mt-3 w-full"
          variant="secondary"
          onClick={() => startServiceOrder(order.id)}
        >
          Receive & start work
        </Button>
        </div>
      )}

      {!locked && !reviewing && (panel ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Step 2 · Record findings</p>
            <p className="text-xs text-zinc-500">
              {completedFields} of {parameters.length} complete
            </p>
          </div>
          {parameters.map((p) => {
            const value = values[p.name] ?? "";
            const numericValue = Number(value);
            const isNumeric = p.refLow != null || p.refHigh != null;
            const low = value.trim() !== "" && Number.isFinite(numericValue) && p.refLow != null && numericValue < p.refLow;
            const high = value.trim() !== "" && Number.isFinite(numericValue) && p.refHigh != null && numericValue > p.refHigh;
            return (
            <div key={p.name} className="rounded-lg border border-zinc-200 p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-zinc-700">
                {p.name}
                {p.unit && (
                  <span className="ml-1 text-zinc-400">({p.unit})</span>
                )}
              </label>
              {(p.refLow != null || p.refHigh != null) && (
                <span className="text-[11px] tabular-nums text-zinc-500">
                  Normal: {p.refLow ?? "—"}–{p.refHigh ?? "—"} {p.unit}
                </span>
              )}
              </div>
              <input
                className={`${inputClass} w-full ${low || high ? "border-red-400 bg-red-50" : ""}`}
                type={isNumeric ? "number" : "text"}
                step={isNumeric ? "any" : undefined}
                list={isNumeric ? undefined : `results-${order.id}`}
                placeholder={isNumeric ? "Enter measured value" : "e.g. Positive, Negative or finding"}
                value={value}
                disabled={locked}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [p.name]: e.target.value }))
                }
              />
              {(low || high) && (
                <p className="mt-1 text-xs font-medium text-red-700">
                  Outside the configured normal range ({low ? "low" : "high"})
                </p>
              )}
            </div>
          )})}
          <datalist id={`results-${order.id}`}>
            <option value="Negative" />
            <option value="Positive" />
            <option value="Normal" />
            <option value="Abnormal" />
          </datalist>
          <textarea
            className={`${inputClass} h-14 w-full py-2`}
            placeholder="Comment (optional)…"
            value={freeText}
            disabled={locked}
            onChange={(e) => setFreeText(e.target.value)}
          />
        </div>
      ) : (
        <textarea
          className={`${inputClass} mt-3 h-20 w-full py-2`}
          placeholder="Enter result / findings…"
          value={freeText}
          disabled={locked}
          onChange={(e) => setFreeText(e.target.value)}
        />
      ))}

      {!locked && !reviewing && <Button
        className="mt-3 w-full"
        disabled={!filled}
        onClick={() => setReviewing(true)}
      >
        {filled ? "Review findings" : panel ? "Complete every result" : "Enter findings"}
      </Button>}

      {reviewing && (
        <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Step 3 · Review & return</p>
          <p className="mt-1 text-sm text-teal-950">Check these findings carefully. Confirming completes the order and returns the patient to the doctor when all requested services are done.</p>
          {panel && <ul className="mt-3 space-y-1 text-sm">{parameters.map((p) => <li key={p.name} className="flex justify-between gap-3"><span>{p.name}</span><strong>{values[p.name]} {p.unit}</strong></li>)}</ul>}
          {!panel && <p className="mt-3 rounded-lg bg-white p-3 text-sm">{freeText}</p>}
          {freeText && panel && <p className="mt-3 text-sm text-teal-900">Comment: {freeText}</p>}
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => setReviewing(false)}>Back to edit</Button>
            <Button className="flex-1" disabled={busy} onClick={file}>{busy ? "Saving…" : "Confirm & return"}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
